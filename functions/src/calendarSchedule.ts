/**
 * calendarSchedule — Google Calendar → App 역동기화 스케줄러
 */
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { listCalendarEvents, parseEventToReservation } from "./calendarSync";

const db = getFirestore();
const auth = getAuth();

/**
 * 이메일로 Firebase Auth 사용자 조회 (UID + displayName)
 */
async function findUserByEmail(email: string) {
    if (!email) return null;
    try {
        return await auth.getUserByEmail(email);
    } catch {
        return null;
    }
}

/**
 * Google Calendar -> App 역동기화 (10분마다)
 */
export const syncCalendarToApp = onSchedule(
    {
        schedule: "every 5 minutes",
        timeZone: "Asia/Seoul",
        retryCount: 1,
    },
    async function () {
        console.log("=== Calendar -> App reverse sync start ===");

        try {
            // googleCalendarId가 있는 모든 차량 조회
            const vehiclesSnap = await db.collection("vehicles")
                .where("googleCalendarId", "!=", "")
                .get();

            if (vehiclesSnap.empty) {
                console.log("No calendar-linked vehicles, skip");
                return;
            }

            // 조회 범위: 오늘 기준 -1일 ~ +7일
            const now = new Date();
            const timeMin = new Date(now);
            timeMin.setDate(timeMin.getDate() - 1);
            timeMin.setHours(0, 0, 0, 0);
            const timeMax = new Date(now);
            timeMax.setDate(timeMax.getDate() + 7);
            timeMax.setHours(23, 59, 59, 999);

            let totalCreated = 0;
            let totalUpdated = 0;
            let totalCancelled = 0;
            let totalSkippedDup = 0;

            // 동일 calendarEventId가 여러 차량 캘린더에 존재할 때 중복 예약 방지
            const globalProcessedEventIds = new Set<string>();

            for (let i = 0; i < vehiclesSnap.docs.length; i++) {
                const vehicleDoc = vehiclesSnap.docs[i];
                const vehicle = vehicleDoc.data();
                const vehicleId = vehicleDoc.id;
                const calendarId = vehicle.googleCalendarId as string;
                const vehicleName = (vehicle.displayName as string) || "";
                const organizationId = vehicle.organizationId as string;

                // 유효하지 않은 캘린더 ID 건너뛰기 (@ 포함 필수)
                if (!calendarId || !calendarId.includes("@")) {
                    console.log("Vehicle " + vehicleName + "(" + vehicleId + "): invalid calendar ID, skip");
                    continue;
                }

                try {
                    // 1. 캘린더 이벤트 조회
                    const calendarEvents = await listCalendarEvents(
                        calendarId,
                        timeMin.toISOString(),
                        timeMax.toISOString()
                    );

                    // 2. 해당 차량의 기존 예약 조회
                    const dateMin = timeMin.toISOString().slice(0, 10);
                    const dateMax = timeMax.toISOString().slice(0, 10);
                    const existingSnap = await db.collection("reservations")
                        .where("vehicleId", "==", vehicleId)
                        .where("date", ">=", dateMin)
                        .where("date", "<=", dateMax)
                        .get();

                    const existingByEventId: Record<string, Record<string, unknown>> = {};
                    const existingReservations: Array<Record<string, unknown>> = [];
                    existingSnap.docs.forEach(function (d) {
                        const data: Record<string, unknown> = { id: d.id, ...d.data() };
                        existingReservations.push(data);
                        if (data.calendarEventId) {
                            existingByEventId[data.calendarEventId as string] = data;
                            // 이미 존재하는 예약의 calendarEventId를 전역 Set에 등록
                            if (data.status !== "cancelled") {
                                globalProcessedEventIds.add(data.calendarEventId as string);
                            }
                        }
                    });

                    const calendarEventIds = new Set(calendarEvents.map(function (e) { return e.id; }));

                    // 3. 캘린더 이벤트 기준으로 동기화
                    for (let j = 0; j < calendarEvents.length; j++) {
                        const calEvent = calendarEvents[j];
                        // 취소된 이벤트는 건너뜀
                        if (calEvent.status === "cancelled") continue;

                        let existing = existingByEventId[calEvent.id];

                        if (!existing) {
                            // calendarEventId로 연결되지 않은 예약 중에서, 동일 조건(날짜, 시간, 차량)의 앱 생성 예약 찾기
                            const tempParsed = parseEventToReservation(calEvent, vehicleId, vehicleName, organizationId) as Record<string, unknown>;
                            const matchingAppReservation = existingReservations.find(function (r) {
                                return r.date === tempParsed.date &&
                                       r.startTime === tempParsed.startTime &&
                                       r.endTime === tempParsed.endTime &&
                                       r.vehicleId === vehicleId &&
                                       r.status !== "cancelled" &&
                                       !r.calendarEventId; // 아직 calendarEventId가 없는 예약 (최신 생성 등)
                            });

                            if (matchingAppReservation) {
                                // 앱에서 생성되었으나 아직 calendarEventId가 매핑되지 않은 예약 발견
                                existing = matchingAppReservation;
                                // Firestore에 calendarEventId 업데이트 후 중첩 방지
                                await db.collection("reservations").doc(existing.id as string).update({
                                    calendarEventId: calEvent.id
                                });
                                existing.calendarEventId = calEvent.id;
                                existingByEventId[calEvent.id] = existing;
                                globalProcessedEventIds.add(calEvent.id);
                                console.log("[" + vehicleName + "] Linked unmapped app reservation " + existing.id + " with calendar event " + calEvent.id);
                            }
                        }

                        if (!existing) {
                            // 같은 calendarEventId가 다른 차량에서 이미 처리되었으면 건너뛰기
                            if (globalProcessedEventIds.has(calEvent.id)) {
                                totalSkippedDup++;
                                console.log("[" + vehicleName + "] Skip duplicate calendarEventId: " + calEvent.id + " (" + calEvent.summary + ")");
                                continue;
                            }

                            // 새 이벤트 -> Firestore에 예약 생성
                            const reservationData = parseEventToReservation(
                                calEvent, vehicleId, vehicleName, organizationId
                            ) as Record<string, unknown>;

                            // creator.email로 사용자 UID 및 이름 조회
                            if (reservationData.creatorEmail) {
                                const userRecord = await findUserByEmail(reservationData.creatorEmail as string);
                                if (userRecord) {
                                    reservationData.reservedByUid = userRecord.uid;
                                    reservationData.userId = userRecord.uid;
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
                            globalProcessedEventIds.add(calEvent.id);
                            totalCreated++;
                            console.log("[" + vehicleName + "] New reservation: " + calEvent.summary + " (" + calEvent.id + ")");
                        } else {
                            // 기존 예약이 있음 -> 내용 비교 후 업데이트
                            const parsed = parseEventToReservation(
                                calEvent, vehicleId, vehicleName, organizationId
                            );

                            const fieldsToCompare = ["date", "startTime", "endTime", "purpose", "destination"];
                            const changed = fieldsToCompare.some(function (f) { return (parsed as Record<string, unknown>)[f] !== existing[f]; });

                            if (changed && existing.syncSource === "calendar") {
                                await db.collection("reservations").doc(existing.id as string).update({
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
                    for (let k = 0; k < existingReservations.length; k++) {
                        const reservation = existingReservations[k];
                        if (
                            reservation.calendarEventId &&
                            reservation.syncSource === "calendar" &&
                            reservation.status !== "cancelled" &&
                            !calendarEventIds.has(reservation.calendarEventId as string)
                        ) {
                            await db.collection("reservations").doc(reservation.id as string).update({
                                status: "cancelled",
                                syncSource: "calendar",
                            });
                            totalCancelled++;
                            console.log("[" + vehicleName + "] Reservation cancelled (calendar deleted): " + reservation.id);
                        }
                    }
                } catch (vehicleErr: unknown) {
                    console.error("Vehicle " + vehicleName + "(" + vehicleId + ") sync failed:", (vehicleErr as Error).message);
                }
            }

            console.log("=== Reverse sync done: created " + totalCreated + ", updated " + totalUpdated + ", cancelled " + totalCancelled + ", skippedDup " + totalSkippedDup + " ===");
        } catch (err: unknown) {
            console.error("Reverse sync overall failed:", (err as Error).message);
        }
    }
);
