/**
 * reservationTriggers — 예약 Firestore 트리거 (Google Calendar 연동 + 푸시 알림)
 */
import { getFirestore } from "firebase-admin/firestore";
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "../../services/calendar/calendarSync";
import { sendPushToOrg, sendPushToUser, createInAppNotification } from "../../services/alimtalk/sendNotification";

/**
 * 차량의 googleCalendarId를 조회
 */
async function getVehicleCalendarId(vehicleId: string): Promise<string | null> {
    if (!vehicleId) return null;
    const db = getFirestore();
    const snap = await db.collection("vehicles").doc(vehicleId).get();
    if (!snap.exists) return null;
    const calendarId = (snap.data()?.googleCalendarId as string) || null;
    // 유효하지 않은 캘린더 ID 필터링 (@ 포함 필수)
    if (calendarId && !calendarId.includes("@")) return null;
    return calendarId;
}

/**
 * 예약 생성 시 -> 캘린더 이벤트 생성
 */
export const onReservationCreated = onDocumentCreated("reservations/{reservationId}", async (event) => {
    const reservation = event.data!.data();
    const reservationId = event.params.reservationId;

    // 역동기화로 생성된 예약이면 캘린더에 다시 생성하지 않음 (무한 루프 방지)
    if (reservation.syncSource === "calendar") {
        console.log("Reservation " + reservationId + ": calendar reverse-sync, skip calendar event creation");
        return;
    }

    // 승인 대기(pending) 상태라면 캘린더 이벤트를 만들지 않음
    if (reservation.status !== 'pending') {
        try {
            const calendarId = await getVehicleCalendarId(reservation.vehicleId);
            if (!calendarId) {
                console.log("Vehicle " + reservation.vehicleId + ": no calendar ID, skip");
                // 캘린더 연동을 안해도 실패 처리는 아님, 알림 로직으로 넘어가도록 수정
            } else {
                const eventId = await createCalendarEvent(calendarId, reservation as any);

                // 생성된 이벤트 ID를 예약 문서에 저장
                await getFirestore().collection("reservations").doc(reservationId).update({
                    calendarEventId: eventId,
                });

                console.log("Reservation " + reservationId + ": calendar event created (" + eventId + ")");
            }
        } catch (err: unknown) {
            console.error("Reservation " + reservationId + ": calendar event creation failed", (err as Error).message);
        }
    } else {
        console.log("Reservation " + reservationId + ": status is pending, skipping calendar event creation");
    }

    // 푸시 알림 전송 (예약 관리자/지정 수신자에게)
    try {
        if (reservation.organizationId) {
            const title = reservation.status === 'pending' ? '새 예약 신청 (승인 대기)' : '새 차량 예약';
            const body = reservation.status === 'pending' 
                ? `${reservation.reservedByName || '사용자'}님이 ${reservation.vehicleName || '차량'} 예약을 신청했습니다. 승인 대기 중입니다.` 
                : `${reservation.reservedByName || '사용자'}님이 ${reservation.vehicleName || '차량'} 예약 (${reservation.date} ${reservation.startTime || ''})`;
            
            await sendPushToOrg(
                reservation.organizationId,
                { title, body },
                reservation.reservedByUid || reservation.reservedBy
            );
        }
    } catch (err: unknown) {
        console.error("Reservation " + reservationId + ": push notification failed", (err as Error).message);
    }
});

/**
 * 예약 수정 시 -> 캘린더 이벤트 수정 또는 삭제 + 알림 전송
 */
export const onReservationUpdated = onDocumentUpdated("reservations/{reservationId}", async (event) => {
    const before = event.data!.before.data();
    const after = event.data!.after.data();
    const reservationId = event.params.reservationId;

    // 역동기화로 수정된 예약이면 캘린더에 다시 반영하지 않음 (무한 루프 방지)
    if (after.syncSource === "calendar" && before.syncSource !== "calendar") {
        console.log("Reservation " + reservationId + ": calendar reverse-sync update, skip");
        return;
    }

    // calendarEventId 업데이트는 무시 (무한 루프 방지)
    if (!before.calendarEventId && after.calendarEventId && before.status === after.status) {
        return;
    }

    // reminderSent / driveLogReminderSent 업데이트만 변경된 경우 무시
    if (before.status === after.status && before.date === after.date && before.startTime === after.startTime) {
        const ignoredFields = ["reminderSent", "driveLogReminderSent", "calendarEventId", "actualStartTime"];
        const nonIgnoredChanged = Object.keys(after).some(function (k) {
            return !ignoredFields.includes(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]);
        });
        if (!nonIgnoredChanged) return;
    }

    try {
        const calendarId = await getVehicleCalendarId(after.vehicleId);

        const eventId = after.calendarEventId;

        // 반려된 경우 (pending -> rejected)
        if (after.status === "rejected" && before.status === "pending") {
            if (after.reservedByUid || after.userId) {
                const uid = after.reservedByUid || after.userId;
                const bodyMsg = `${after.vehicleDisplayName || "차량"} 예약이 반려되었습니다.${after.rejectedReason ? ` 사유: ${after.rejectedReason}` : ''}`;
                await createInAppNotification(uid, "reservation_rejected", "❌ 예약 반려", bodyMsg, after.organizationId);
                await sendPushToUser(uid, { title: "❌ 예약 반려", body: bodyMsg });
            }
            return;
        }

        // 승인된 경우 (pending -> reserved)
        if (after.status === "reserved" && before.status === "pending") {
            let newEventId = eventId;
            if (calendarId && !eventId) {
                try {
                    newEventId = await createCalendarEvent(calendarId, after as any);
                    await getFirestore().collection("reservations").doc(reservationId).update({
                        calendarEventId: newEventId,
                    });
                } catch(e) {
                    console.error("Calendar creation failed on approval:", e);
                }
            }
            if (after.reservedByUid || after.userId) {
                const uid = after.reservedByUid || after.userId;
                const bodyMsg = `${after.vehicleDisplayName || "차량"} 예약이 승인되었습니다. (${after.date} ${after.startTime || ""})`;
                await createInAppNotification(uid, "reservation_approved", "✅ 예약 승인", bodyMsg, after.organizationId);
                await sendPushToUser(uid, { title: "✅ 예약 승인", body: bodyMsg });
            }
            return;
        }

        // 취소된 경우 -> 이벤트 삭제 + 알림
        if (after.status === "cancelled" && before.status !== "cancelled") {
            if (calendarId && eventId) {
                await deleteCalendarEvent(calendarId, eventId);
                console.log("Reservation " + reservationId + ": cancelled -> calendar event deleted");
            }

            // 예약자에게 취소 알림 (취소한 본인이 아닌 경우)
            if (after.userId) {
                await createInAppNotification(
                    after.userId,
                    "reservation_cancelled",
                    "🚫 예약 취소",
                    (after.vehicleDisplayName || "차량") + " 예약(" + after.date + " " + (after.startTime || "") + ")이 취소되었습니다.",
                    after.organizationId
                );
                await sendPushToUser(after.userId, {
                    title: "🚫 예약 취소",
                    body: (after.vehicleDisplayName || "차량") + " 예약(" + after.date + ")이 취소되었습니다.",
                });
            }
            return;
        }

        // 일반 수정 -> 이벤트 업데이트 + 변경 알림
        const relevantFields = ["date", "startTime", "endTime", "vehicleName", "purpose", "destination", "reservedByName"];
        const changed = relevantFields.some(function (f) { return before[f] !== after[f]; });

        if (changed) {
            if (calendarId && eventId) {
                await updateCalendarEvent(calendarId, eventId, after as any);
                console.log("Reservation " + reservationId + ": calendar event updated");
            }

            // 예약자에게 변경 알림
            if (after.userId) {
                const changeParts: string[] = [];
                if (before.date !== after.date) changeParts.push("날짜: " + after.date);
                if (before.startTime !== after.startTime || before.endTime !== after.endTime) {
                    changeParts.push("시간: " + (after.startTime || "") + "~" + (after.endTime || ""));
                }
                if (before.destination !== after.destination) changeParts.push("목적지: " + (after.destination || ""));

                const changeMsg = changeParts.length > 0
                    ? (after.vehicleDisplayName || "차량") + " 예약이 변경되었습니다. (" + changeParts.join(", ") + ")"
                    : (after.vehicleDisplayName || "차량") + " 예약 정보가 변경되었습니다.";

                await createInAppNotification(
                    after.userId,
                    "reservation_changed",
                    "✏️ 예약 변경",
                    changeMsg,
                    after.organizationId
                );
                await sendPushToUser(after.userId, {
                    title: "✏️ 예약 변경",
                    body: changeMsg,
                });
            }
        }
    } catch (err: unknown) {
        console.error("Reservation " + reservationId + ": calendar event update failed", (err as Error).message);
    }
});

/**
 * 예약 삭제 시 -> 캘린더 이벤트 삭제
 */
export const onReservationDeleted = onDocumentDeleted("reservations/{reservationId}", async (event) => {
    const reservation = event.data!.data();
    const reservationId = event.params.reservationId;

    try {
        if (!reservation.calendarEventId) return;

        const calendarId = await getVehicleCalendarId(reservation.vehicleId);
        if (!calendarId) return;

        await deleteCalendarEvent(calendarId, reservation.calendarEventId);
        console.log("Reservation " + reservationId + ": deleted -> calendar event deleted");
    } catch (err: unknown) {
        console.error("Reservation " + reservationId + ": calendar event delete failed", (err as Error).message);
    }
});
