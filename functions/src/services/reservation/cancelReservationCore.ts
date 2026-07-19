/**
 * cancelReservationCore — 예약 취소의 권위(authoritative) 코어 로직
 *
 * 호출 경로(메신저 어시스턴트 등)와 무관하게 동일한 검증을 강제한다:
 *   - 조직 격리 (actorOrgId === 예약 organizationId)
 *   - 소유자 검증 (reservedByUid === actorUid) — 본인 예약만 취소
 *   - 상태 가드 (pending/reserved만 취소 가능, completed/cancelled/rejected 불가)
 *
 * status를 'cancelled'로 바꾸면 reservationTriggers(onReservationUpdated)가
 * 캘린더 이벤트 삭제·알림을 자동 처리하므로 여기서는 상태만 전이한다.
 */
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const db = getFirestore();

export interface CancelReservationInput {
    reservationId: string;
    /** 취소를 요청하는 실제 사용자 UID — 예약 소유자와 일치해야 한다 */
    actorUid: string;
    /** 호출자의 소속 기관 ID — 예약 organizationId와 불일치 시 거부 */
    actorOrgId: string;
}

export interface CancelReservationResult {
    vehicleName: string;
    date: string;
    startTime: string;
    endTime: string;
}

/** 취소 가능한 상태 (진행 예정 예약만) */
const CANCELABLE_STATUSES = new Set(["pending", "reserved"]);

export async function cancelReservationTx(
    input: CancelReservationInput
): Promise<CancelReservationResult> {
    const { reservationId, actorUid, actorOrgId } = input;

    if (!reservationId || !actorUid || !actorOrgId) {
        throw new HttpsError(
            "invalid-argument",
            "reservationId, actorUid, actorOrgId는 필수입니다."
        );
    }

    try {
        return await db.runTransaction(async (transaction) => {
            const ref = db.collection("reservations").doc(reservationId);
            const snap = await transaction.get(ref);

            if (!snap.exists) {
                throw new HttpsError("not-found", "예약을 찾을 수 없습니다.");
            }

            const r = snap.data()!;

            // 조직 격리 — 타 기관 예약 취소 차단
            if (r.organizationId !== actorOrgId) {
                throw new HttpsError("permission-denied", "자기 기관의 예약만 취소할 수 있습니다.");
            }

            // 소유자 검증 — 본인이 예약한 건만 취소 (관리자 대리 취소는 앱에서)
            if (r.reservedByUid !== actorUid) {
                throw new HttpsError("permission-denied", "본인이 예약한 건만 취소할 수 있습니다.");
            }

            // 상태 가드
            if (r.status === "cancelled") {
                throw new HttpsError("failed-precondition", "이미 취소된 예약입니다.");
            }
            if (!CANCELABLE_STATUSES.has(r.status)) {
                throw new HttpsError("failed-precondition", "취소할 수 없는 상태의 예약입니다.");
            }

            transaction.update(ref, {
                status: "cancelled",
                cancelledAt: FieldValue.serverTimestamp(),
            });

            return {
                vehicleName: r.vehicleName || "",
                date: r.date || "",
                startTime: r.startTime || "",
                endTime: r.endTime || "",
            };
        });
    } catch (err: unknown) {
        if (err instanceof HttpsError) throw err;
        console.error("cancelReservationTx 실패:", (err as Error).message);
        throw new HttpsError("internal", "예약 취소에 실패했습니다.");
    }
}
