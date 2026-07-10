/**
 * reservationTriggers — 예약 Firestore 트리거 (Google Calendar 연동 + 푸시 알림)
 */
import { getFirestore } from "firebase-admin/firestore";
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "../../services/calendar/calendarSync";
import { isCalendarAuthError, shouldSkipVehicleCalendar, recordCalendarFailure, resetCalendarFailure } from "../../services/calendar/calendarFailTracking";
import { sendPushToOrg, sendPushToUser, createInAppNotification } from "../../services/alimtalk/sendNotification";
import { checkReservationTimeConflict, resolveReservationConflict } from "../sync/conflictResolver";

/**
 * 차량의 캘린더 동기화 컨텍스트를 조회한다.
 * - calendarId: 유효한 googleCalendarId(@ 포함). 없거나 형식 오류면 null.
 * - failCount : 누적 실패 횟수 (백오프 판단/리셋용).
 * - skip      : 실패 누적으로 쿨다운/영구제외 상태라 캘린더 호출을 건너뛰어야 하는지.
 *
 * 차량 문서가 없거나 calendarId가 유효하지 않으면 null을 반환한다.
 */
async function getVehicleCalendar(
    vehicleId: string,
    expectedOrgId?: string,
): Promise<{ calendarId: string; failCount: number; skip: boolean } | null> {
    if (!vehicleId) return null;
    const db = getFirestore();
    const snap = await db.collection("vehicles").doc(vehicleId).get();
    if (!snap.exists) return null;
    const data = snap.data()!;
    // 차량이 예약의 기관 소속이 아니면 캘린더를 다루지 않는다 — 미검증 vehicleId를 통한
    // 타 기관 Google Calendar 이벤트 주입 차단 (2026-07-04 감사 N3)
    if (expectedOrgId && data.organizationId !== expectedOrgId) return null;
    const calendarId = (data.googleCalendarId as string) || null;
    // 유효하지 않은 캘린더 ID 필터링 (@ 포함 필수)
    if (!calendarId || !calendarId.includes("@")) return null;
    return {
        calendarId,
        failCount: (data.calendarSyncFailCount as number) || 0,
        skip: shouldSkipVehicleCalendar(data),
    };
}

/**
 * 알림 대상 uid가 예약의 기관 소속인지 검증한다.
 * 예약 생성 규칙은 reservedByUid만 본인으로 고정하고 userId는 제약하지 않으므로,
 * 트리거가 userId를 신뢰하면 타 기관 임의 사용자에게 알림·푸시를 주입할 수 있다(2026-07-04 감사 N2).
 * 대상 문서의 organizationId가 예약 org와 일치할 때만 알림을 보낸다.
 */
async function isNotifiableOrgMember(uid: string | undefined | null, orgId: string | undefined | null): Promise<boolean> {
    if (!uid || !orgId) return false;
    const snap = await getFirestore().collection("users").doc(uid).get();
    return snap.exists && snap.data()?.organizationId === orgId;
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

    // [오프라인 충돌 방어] 생성 시 시간 겹침 검사
    if (reservation.status === 'pending' || reservation.status === 'reserved') {
        const isTimeConflict = await checkReservationTimeConflict(
            reservation.vehicleId,
            reservation.date,
            reservation.startTime,
            reservation.endTime,
            reservationId
        );
        if (isTimeConflict) {
            await getFirestore().collection("reservations").doc(reservationId).update({
                status: "rejected",
                rejectedReason: "offline_time_conflict"
            });
            const uid = reservation.reservedByUid || reservation.userId;
            if (await isNotifiableOrgMember(uid, reservation.organizationId)) {
                const bodyMsg = `[오프라인 동기화 안내] ${reservation.vehicleDisplayName || "차량"} 예약이 이미 다른 예약과 시간이 겹쳐 반려/취소되었습니다. (${reservation.date})`;
                await createInAppNotification(uid, "reservation_rejected", "⚠️ 예약 시간 충돌", bodyMsg, reservation.organizationId);
                await sendPushToUser(uid, { title: "⚠️ 예약 시간 충돌", body: bodyMsg });
            }
            return;
        }
    }

    // 승인 대기(pending) 상태라면 캘린더 이벤트를 만들지 않음
    if (reservation.status !== 'pending') {
        const vc = await getVehicleCalendar(reservation.vehicleId, reservation.organizationId);
        if (!vc) {
            console.log("Vehicle " + reservation.vehicleId + ": no calendar ID, skip");
            // 캘린더 연동을 안해도 실패 처리는 아님, 알림 로직으로 넘어가도록 수정
        } else if (vc.skip) {
            // 실패 누적(쿨다운/영구제외)으로 캘린더 호출을 건너뜀 — 반복 404로 인한 Sentry 스팸/쿼터 낭비 방지
            console.log("Vehicle " + reservation.vehicleId + ": calendar sync disabled (failCount=" + vc.failCount + "), skip");
        } else {
            try {
                const eventId = await createCalendarEvent(vc.calendarId, reservation as Parameters<typeof createCalendarEvent>[1]);

                // 생성된 이벤트 ID를 예약 문서에 저장
                await getFirestore().collection("reservations").doc(reservationId).update({
                    calendarEventId: eventId,
                });

                // 성공: 직전까지 누적된 실패 카운트가 있으면 리셋
                if (vc.failCount > 0) await resetCalendarFailure(reservation.vehicleId);

                console.log("Reservation " + reservationId + ": calendar event created (" + eventId + ")");
            } catch (err: unknown) {
                const { captureError } = await import("../../core/sentry");
                captureError(err, { context: "officialCalendarSync_created", reservationId, vehicleId: reservation.vehicleId });
                console.error("Reservation " + reservationId + ": calendar event creation failed", (err as Error).message);
                // 캘린더 부재/권한 오류(404·403)면 실패 카운트 증가 → 쿨다운/영구제외로 자동 백오프
                if (isCalendarAuthError(err)) await recordCalendarFailure(reservation.vehicleId, vc.failCount);
            }
        }

        // 개인 구글 캘린더 동기화 (예외 격리)
        if (reservation.reservedByUid) {
            try {
                const oauthSnap = await getFirestore().collection("users").doc(reservation.reservedByUid).collection("private").doc("oauth").get();
                if (oauthSnap.exists && oauthSnap.data()?.refreshToken) {
                    const { getValidOAuth2Client, createPersonalCalendarEvent } = await import("../../services/calendar/personalCalendarSync");
                    const oauth2Client = await getValidOAuth2Client(reservation.reservedByUid);
                    const personalEventId = await createPersonalCalendarEvent(oauth2Client, reservation as Parameters<typeof createPersonalCalendarEvent>[1]);
                    await getFirestore().collection("reservations").doc(reservationId).update({
                        personalCalendarEventId: personalEventId,
                    });
                    console.log("Reservation " + reservationId + ": personal calendar event created (" + personalEventId + ")");
                }
            } catch (err: unknown) {
                const { captureError } = await import("../../core/sentry");
                captureError(err, { context: "personalCalendarSync_created", reservationId, reservedByUid: reservation.reservedByUid });
                console.error("Reservation " + reservationId + ": personal calendar event creation failed", (err as Error).message);
            }
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

    // [오프라인 충돌 방어] LWW 기반
    const isConflict = await resolveReservationConflict(event.data!.after.ref, before, after);
    if (isConflict) return;

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

    // [오프라인 충돌 방어] 시간이나 상태가 변경된 경우 겹침 체크
    if (after.status === 'pending' || after.status === 'reserved') {
        const timeChanged = before.date !== after.date || before.startTime !== after.startTime || before.endTime !== after.endTime || before.status !== after.status;
        if (timeChanged) {
            const isTimeConflict = await checkReservationTimeConflict(after.vehicleId, after.date, after.startTime, after.endTime, reservationId);
            if (isTimeConflict) {
                await event.data!.after.ref.update({ status: "rejected", rejectedReason: "offline_time_conflict" });
                const uid = after.reservedByUid || after.userId;
                if (await isNotifiableOrgMember(uid, after.organizationId)) {
                    const bodyMsg = `[오프라인 동기화 안내] ${after.vehicleDisplayName || "차량"} 예약 변경이 다른 예약과 시간이 겹쳐 반려/취소되었습니다.`;
                    await createInAppNotification(uid, "reservation_rejected", "⚠️ 예약 시간 충돌", bodyMsg, after.organizationId);
                    await sendPushToUser(uid, { title: "⚠️ 예약 시간 충돌", body: bodyMsg });
                }
                return;
            }
        }
    }

    // 실패 누적(쿨다운/영구제외) 차량은 calendarId를 null 처리해 모든 캘린더 호출을 건너뛴다 (알림은 그대로 진행)
    const vc = await getVehicleCalendar(after.vehicleId, after.organizationId);
    const calendarId = (vc && !vc.skip) ? vc.calendarId : null;
    const calendarFailCount = vc?.failCount ?? 0;

    try {
        const eventId = after.calendarEventId;

        // 반려된 경우 (pending -> rejected)
        if (after.status === "rejected" && before.status === "pending") {
            const uid = after.reservedByUid || after.userId;
            if (await isNotifiableOrgMember(uid, after.organizationId)) {
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
                    newEventId = await createCalendarEvent(calendarId, after as Parameters<typeof createCalendarEvent>[1]);
                    await getFirestore().collection("reservations").doc(reservationId).update({
                        calendarEventId: newEventId,
                    });
                    if (calendarFailCount > 0) await resetCalendarFailure(after.vehicleId);
                } catch(e: unknown) {
                    const { captureError } = await import("../../core/sentry");
                    captureError(e, { context: "officialCalendarSync_approval_created", reservationId, vehicleId: after.vehicleId });
                    console.error("Calendar creation failed on approval:", (e as Error).message);
                    if (isCalendarAuthError(e)) await recordCalendarFailure(after.vehicleId, calendarFailCount);
                }
            }

            // 개인 캘린더 생성 (예외 격리)
            if (after.reservedByUid && !after.personalCalendarEventId) {
                try {
                    const oauthSnap = await getFirestore().collection("users").doc(after.reservedByUid).collection("private").doc("oauth").get();
                    if (oauthSnap.exists && oauthSnap.data()?.refreshToken) {
                        const { getValidOAuth2Client, createPersonalCalendarEvent } = await import("../../services/calendar/personalCalendarSync");
                        const oauth2Client = await getValidOAuth2Client(after.reservedByUid);
                        const personalEventId = await createPersonalCalendarEvent(oauth2Client, after as Parameters<typeof createPersonalCalendarEvent>[1]);
                        await getFirestore().collection("reservations").doc(reservationId).update({
                            personalCalendarEventId: personalEventId,
                        });
                        console.log("Reservation " + reservationId + ": personal calendar event created on approval (" + personalEventId + ")");
                    }
                } catch (err: unknown) {
                    const { captureError } = await import("../../core/sentry");
                    captureError(err, { context: "personalCalendarSync_approved", reservationId, reservedByUid: after.reservedByUid });
                    console.error("Reservation " + reservationId + ": personal calendar event creation on approval failed", (err as Error).message);
                }
            }

            const approveUid = after.reservedByUid || after.userId;
            if (await isNotifiableOrgMember(approveUid, after.organizationId)) {
                const bodyMsg = `${after.vehicleDisplayName || "차량"} 예약이 승인되었습니다. (${after.date} ${after.startTime || ""})`;
                await createInAppNotification(approveUid, "reservation_approved", "✅ 예약 승인", bodyMsg, after.organizationId);
                await sendPushToUser(approveUid, { title: "✅ 예약 승인", body: bodyMsg });
            }
            return;
        }

        // 취소된 경우 -> 이벤트 삭제 + 알림
        if (after.status === "cancelled" && before.status !== "cancelled") {
            if (calendarId && eventId) {
                await deleteCalendarEvent(calendarId, eventId);
                console.log("Reservation " + reservationId + ": cancelled -> calendar event deleted");
            }

            // 개인 캘린더 삭제 (예외 격리)
            if (after.reservedByUid && after.personalCalendarEventId) {
                try {
                    const { getValidOAuth2Client, deletePersonalCalendarEvent } = await import("../../services/calendar/personalCalendarSync");
                    const oauth2Client = await getValidOAuth2Client(after.reservedByUid);
                    await deletePersonalCalendarEvent(oauth2Client, after.personalCalendarEventId);
                    console.log("Reservation " + reservationId + ": cancelled -> personal calendar event deleted");
                } catch (err: unknown) {
                    const { captureError } = await import("../../core/sentry");
                    captureError(err, { context: "personalCalendarSync_cancelled", reservationId, reservedByUid: after.reservedByUid });
                    console.error("Reservation " + reservationId + ": personal calendar event delete failed", (err as Error).message);
                }
            }

            // 예약자에게 취소 알림 (취소한 본인이 아닌 경우) — 대상이 예약 org 소속일 때만
            if (await isNotifiableOrgMember(after.userId, after.organizationId)) {
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
                await updateCalendarEvent(calendarId, eventId, after as Parameters<typeof updateCalendarEvent>[2]);
                if (calendarFailCount > 0) await resetCalendarFailure(after.vehicleId);
                console.log("Reservation " + reservationId + ": calendar event updated");
            }

            // 개인 캘린더 수정 (예외 격리)
            if (after.reservedByUid && after.personalCalendarEventId) {
                try {
                    const { getValidOAuth2Client, updatePersonalCalendarEvent } = await import("../../services/calendar/personalCalendarSync");
                    const oauth2Client = await getValidOAuth2Client(after.reservedByUid);
                    await updatePersonalCalendarEvent(oauth2Client, after.personalCalendarEventId, after as Parameters<typeof updatePersonalCalendarEvent>[2]);
                    console.log("Reservation " + reservationId + ": personal calendar event updated");
                } catch (err: unknown) {
                    const { captureError } = await import("../../core/sentry");
                    captureError(err, { context: "personalCalendarSync_updated", reservationId, reservedByUid: after.reservedByUid });
                    console.error("Reservation " + reservationId + ": personal calendar event update failed", (err as Error).message);
                }
            }

            // 예약자에게 변경 알림 — 대상이 예약 org 소속일 때만
            if (await isNotifiableOrgMember(after.userId, after.organizationId)) {
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
        const { captureError } = await import("../../core/sentry");
        captureError(err, { context: "officialCalendarSync_updated", reservationId, vehicleId: after.vehicleId });
        console.error("Reservation " + reservationId + ": calendar event update failed", (err as Error).message);
        // 캘린더 부재/권한 오류(404·403)면 실패 카운트 증가 → 쿨다운/영구제외로 자동 백오프
        if (vc && isCalendarAuthError(err)) await recordCalendarFailure(after.vehicleId, calendarFailCount);
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

        const vc = await getVehicleCalendar(reservation.vehicleId, reservation.organizationId);
        if (!vc) return;
        // 실패 누적(쿨다운/영구제외) 차량은 삭제 호출도 건너뜀 (어차피 404 반복)
        if (vc.skip) {
            console.log("Vehicle " + reservation.vehicleId + ": calendar sync disabled (failCount=" + vc.failCount + "), skip delete");
            return;
        }

        await deleteCalendarEvent(vc.calendarId, reservation.calendarEventId);
        if (vc.failCount > 0) await resetCalendarFailure(reservation.vehicleId);
        console.log("Reservation " + reservationId + ": deleted -> calendar event deleted");
    } catch (err: unknown) {
        const { captureError } = await import("../../core/sentry");
        captureError(err, { context: "officialCalendarSync_deleted", reservationId, vehicleId: reservation.vehicleId });
        console.error("Reservation " + reservationId + ": calendar event delete failed", (err as Error).message);
    }

    // 개인 캘린더 삭제 (예외 격리)
    if (reservation.reservedByUid && reservation.personalCalendarEventId) {
        try {
            const { getValidOAuth2Client, deletePersonalCalendarEvent } = await import("../../services/calendar/personalCalendarSync");
            const oauth2Client = await getValidOAuth2Client(reservation.reservedByUid);
            await deletePersonalCalendarEvent(oauth2Client, reservation.personalCalendarEventId);
            console.log("Reservation " + reservationId + ": deleted -> personal calendar event deleted");
        } catch (err: unknown) {
            const { captureError } = await import("../../core/sentry");
            captureError(err, { context: "personalCalendarSync_deleted", reservationId, reservedByUid: reservation.reservedByUid });
            console.error("Reservation " + reservationId + ": personal calendar event delete failed", (err as Error).message);
        }
    }
});
