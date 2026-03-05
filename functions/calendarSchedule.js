/**
 * calendarSchedule — Google Calendar → App 역동기화 스케줄러
 * index.js에서 분리된 모듈
 */
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { listCalendarEvents, parseEventToReservation } = require("./calendarSync");

const db = getFirestore();
const auth = getAuth();

/**
 * 이메일로 Firebase Auth 사용자 조회 (UID + displayName)
 */
async function findUserByEmail(email) {
    if (!email) return null;
    try {
        return await auth.getUserByEmail(email);
    } catch (err) {
        // 사용자가 없으면 null 반환
        return null;
    }
}

/**
 * Google Calendar -> App 역동기화 (10분마다)
 */
const syncCalendarToApp = onSchedule(
    {
        schedule: "every 5 minutes",
        timeZone: "Asia/Seoul",
        retryCount: 1,
    },
    async function (event) {
        console.log("=== Calendar -> App reverse sync start ===");

        try {
            // googleCalendarId가 있는 모든 차량 조회
            var vehiclesSnap = await db.collection("vehicles")
                .where("googleCalendarId", "!=", "")
                .get();

            if (vehiclesSnap.empty) {
                console.log("No calendar-linked vehicles, skip");
                return;
            }

            // 조회 범위: 오늘 기준 -1일 ~ +7일
            var now = new Date();
            var timeMin = new Date(now);
            timeMin.setDate(timeMin.getDate() - 1);
            timeMin.setHours(0, 0, 0, 0);
            var timeMax = new Date(now);
            timeMax.setDate(timeMax.getDate() + 7);
            timeMax.setHours(23, 59, 59, 999);

            var totalCreated = 0;
            var totalUpdated = 0;
            var totalCancelled = 0;

            for (var i = 0; i < vehiclesSnap.docs.length; i++) {
                var vehicleDoc = vehiclesSnap.docs[i];
                var vehicle = vehicleDoc.data();
                var vehicleId = vehicleDoc.id;
                var calendarId = vehicle.googleCalendarId;
                var vehicleName = vehicle.displayName || "";
                var organizationId = vehicle.organizationId;

                // 유효하지 않은 캘린더 ID 건너뛰기 (@ 포함 필수)
                if (!calendarId || !calendarId.includes("@")) {
                    console.log("Vehicle " + vehicleName + "(" + vehicleId + "): invalid calendar ID, skip");
                    continue;
                }

                try {
                    // 1. 캘린더 이벤트 조회
                    var calendarEvents = await listCalendarEvents(
                        calendarId,
                        timeMin.toISOString(),
                        timeMax.toISOString()
                    );

                    // 2. 해당 차량의 기존 예약 조회
                    var dateMin = timeMin.toISOString().slice(0, 10);
                    var dateMax = timeMax.toISOString().slice(0, 10);
                    var existingSnap = await db.collection("reservations")
                        .where("vehicleId", "==", vehicleId)
                        .where("date", ">=", dateMin)
                        .where("date", "<=", dateMax)
                        .get();

                    var existingByEventId = {};
                    var existingReservations = [];
                    existingSnap.docs.forEach(function (d) {
                        var data = { id: d.id };
                        Object.assign(data, d.data());
                        existingReservations.push(data);
                        if (data.calendarEventId) {
                            existingByEventId[data.calendarEventId] = data;
                        }
                    });

                    var calendarEventIds = new Set(calendarEvents.map(function (e) { return e.id; }));

                    // 3. 캘린더 이벤트 기준으로 동기화
                    for (var j = 0; j < calendarEvents.length; j++) {
                        var calEvent = calendarEvents[j];
                        // 취소된 이벤트는 건너뜀
                        if (calEvent.status === "cancelled") continue;

                        var existing = existingByEventId[calEvent.id];

                        if (!existing) {
                            // 새 이벤트 -> Firestore에 예약 생성
                            var reservationData = parseEventToReservation(
                                calEvent, vehicleId, vehicleName, organizationId
                            );

                            // creator.email로 사용자 UID 및 이름 조회
                            if (reservationData.creatorEmail) {
                                var userRecord = await findUserByEmail(reservationData.creatorEmail);
                                if (userRecord) {
                                    reservationData.reservedByUid = userRecord.uid;
                                    reservationData.userId = userRecord.uid;
                                    // 예약자 이름이 비어 있으면 Auth의 displayName 사용
                                    if (!reservationData.reservedByName && userRecord.displayName) {
                                        reservationData.reservedByName = userRecord.displayName;
                                    }
                                    console.log("[" + vehicleName + "] User matched: " + reservationData.creatorEmail + " -> " + userRecord.uid + " (" + (userRecord.displayName || "") + ")");
                                }
                            }

                            // creatorEmail은 Firestore에 저장하지 않음
                            delete reservationData.creatorEmail;

                            reservationData.createdAt = new Date();
                            await db.collection("reservations").add(reservationData);
                            totalCreated++;
                            console.log("[" + vehicleName + "] New reservation: " + calEvent.summary + " (" + calEvent.id + ")");
                        } else {
                            // 기존 예약이 있음 -> 내용 비교 후 업데이트
                            var parsed = parseEventToReservation(
                                calEvent, vehicleId, vehicleName, organizationId
                            );

                            var fieldsToCompare = ["date", "startTime", "endTime", "purpose", "destination"];
                            var changed = fieldsToCompare.some(function (f) { return parsed[f] !== existing[f]; });

                            if (changed && existing.syncSource === "calendar") {
                                await db.collection("reservations").doc(existing.id).update({
                                    date: parsed.date,
                                    startTime: parsed.startTime,
                                    endTime: parsed.endTime,
                                    purpose: parsed.purpose,
                                    destination: parsed.destination,
                                    reservedByName: parsed.reservedByName,
                                    syncSource: "calendar",
                                });
                                totalUpdated++;
                                console.log("[" + vehicleName + "] Reservation updated: " + existing.id);
                            }
                        }
                    }

                    // 4. Firestore에만 있고 캘린더에 없는 (캘린더에서 삭제된) 이벤트 처리
                    for (var k = 0; k < existingReservations.length; k++) {
                        var reservation = existingReservations[k];
                        if (
                            reservation.calendarEventId &&
                            reservation.syncSource === "calendar" &&
                            reservation.status !== "cancelled" &&
                            !calendarEventIds.has(reservation.calendarEventId)
                        ) {
                            await db.collection("reservations").doc(reservation.id).update({
                                status: "cancelled",
                                syncSource: "calendar",
                            });
                            totalCancelled++;
                            console.log("[" + vehicleName + "] Reservation cancelled (calendar deleted): " + reservation.id);
                        }
                    }
                } catch (vehicleErr) {
                    console.error("Vehicle " + vehicleName + "(" + vehicleId + ") sync failed:", vehicleErr.message);
                }
            }

            console.log("=== Reverse sync done: created " + totalCreated + ", updated " + totalUpdated + ", cancelled " + totalCancelled + " ===");
        } catch (err) {
            console.error("Reverse sync overall failed:", err.message);
        }
    }
);

module.exports = { syncCalendarToApp };
