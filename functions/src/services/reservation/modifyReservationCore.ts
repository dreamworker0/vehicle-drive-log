/**
 * modifyReservationCore — 예약 날짜·시간 수정의 권위(authoritative) 코어 로직
 *
 * 호출 경로(메신저 어시스턴트 등)와 무관하게 동일한 검증을 강제한다:
 *   - 조직 격리 (actorOrgId === 예약 organizationId, 차량 문서 org 일치)
 *   - 소유자 검증 (reservedByUid === actorUid) — 본인 예약만 수정
 *   - 상태 가드 (pending/reserved만 수정 가능)
 *   - 차량 문서 잠금(_lastReservationLock)으로 생성/수정 동시성 방지
 *   - 같은 org+vehicle+date 시간 겹침 검사 (자기 자신 제외)
 *
 * 차량 변경은 지원하지 않는다(같은 차량의 날짜·시간만). 캘린더 이벤트 갱신·알림은
 * 기존 reservationTriggers(onReservationUpdated)가 자동 처리하므로 필드만 갱신한다.
 */
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const db = getFirestore();

export interface ModifyReservationInput {
    reservationId: string;
    /** 수정을 요청하는 실제 사용자 UID — 예약 소유자와 일치해야 한다 */
    actorUid: string;
    /** 호출자의 소속 기관 ID — 예약 organizationId와 불일치 시 거부 */
    actorOrgId: string;
    /** 변경 후 최종 값 (오케스트레이터가 기존값 병합·소요시간 유지까지 계산해 넘긴다) */
    date: string;
    startTime: string;
    endTime: string;
}

export interface ModifyReservationResult {
    vehicleName: string;
    date: string;
    startTime: string;
    endTime: string;
}

/** 수정 가능한 상태 (진행 예정 예약만) */
const MODIFIABLE_STATUSES = new Set(["pending", "reserved"]);

export async function modifyReservationTx(
    input: ModifyReservationInput
): Promise<ModifyReservationResult> {
    const { reservationId, actorUid, actorOrgId, date, startTime, endTime } = input;

    if (!reservationId || !actorUid || !actorOrgId || !date || !startTime || !endTime) {
        throw new HttpsError(
            "invalid-argument",
            "reservationId, actorUid, actorOrgId, date, startTime, endTime은 필수입니다."
        );
    }

    if (startTime >= endTime) {
        throw new HttpsError("invalid-argument", "시작 시간은 종료 시간보다 빨라야 합니다.");
    }

    try {
        return await db.runTransaction(async (transaction) => {
            const ref = db.collection("reservations").doc(reservationId);
            const snap = await transaction.get(ref);

            if (!snap.exists) {
                throw new HttpsError("not-found", "예약을 찾을 수 없습니다.");
            }

            const r = snap.data()!;

            // 조직 격리 — 타 기관 예약 수정 차단
            if (r.organizationId !== actorOrgId) {
                throw new HttpsError("permission-denied", "자기 기관의 예약만 수정할 수 있습니다.");
            }
            // 소유자 검증 — 본인이 예약한 건만 수정
            if (r.reservedByUid !== actorUid) {
                throw new HttpsError("permission-denied", "본인이 예약한 건만 수정할 수 있습니다.");
            }
            // 상태 가드
            if (!MODIFIABLE_STATUSES.has(r.status)) {
                throw new HttpsError("failed-precondition", "수정할 수 없는 상태의 예약입니다.");
            }

            const vehicleId = r.vehicleId as string;

            // 차량 문서 Lock 획득 강제 (생성/수정 동시성 방지) + 차량 org 재검증
            const vehicleRef = db.collection("vehicles").doc(vehicleId);
            const vehicleSnap = await transaction.get(vehicleRef);
            if (!vehicleSnap.exists || vehicleSnap.data()?.organizationId !== actorOrgId) {
                throw new HttpsError("permission-denied", "자기 기관의 차량만 예약할 수 있습니다.");
            }

            // 새 날짜 기준 시간 겹침 검사 — 자기 자신은 제외
            const existingSnap = await transaction.get(
                db.collection("reservations")
                    .where("organizationId", "==", actorOrgId)
                    .where("vehicleId", "==", vehicleId)
                    .where("date", "==", date)
            );

            const overlapping = existingSnap.docs.find((doc) => {
                if (doc.id === reservationId) return false; // 자기 자신 제외
                const other = doc.data();
                if (other.status === "cancelled") return false;

                const effStart = (other.status === "completed" && other.actualStartTime) ? other.actualStartTime : other.startTime;
                const effEnd = (other.status === "completed" && other.actualEndTime) ? other.actualEndTime : other.endTime;

                return startTime < effEnd && endTime > effStart;
            });

            if (overlapping) {
                const other = overlapping.data();
                const effStart = (other.status === "completed" && other.actualStartTime) ? other.actualStartTime : other.startTime;
                const effEnd = (other.status === "completed" && other.actualEndTime) ? other.actualEndTime : other.endTime;
                throw new HttpsError(
                    "already-exists",
                    `해당 차량은 ${effStart} ~ ${effEnd}에 이미 예약되어 있습니다.`
                );
            }

            // 모든 읽기 후 쓰기 (Firestore Transaction 제약)
            transaction.update(vehicleRef, { _lastReservationLock: FieldValue.serverTimestamp() });
            transaction.update(ref, { date, startTime, endTime });

            return {
                vehicleName: (r.vehicleName as string) || "",
                date,
                startTime,
                endTime,
            };
        });
    } catch (err: unknown) {
        if (err instanceof HttpsError) throw err;
        console.error("modifyReservationTx 실패:", (err as Error).message);
        throw new HttpsError("internal", "예약 수정에 실패했습니다.");
    }
}
