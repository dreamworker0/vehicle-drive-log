/**
 * createReservationCore — 예약 생성의 권위(authoritative) 코어 로직
 *
 * createReservationSafe 콜러블에서 추출한 트랜잭션 본문.
 * 호출 경로(콜러블·Slack 어시스턴트 등)와 무관하게 동일한 검증을 강제한다:
 *   - 조직 격리 (actorOrgId === organizationId, 차량 문서 org 일치)
 *   - 차량별 사용 가능 직원 제한 (allowedUserIds)
 *   - 차량 문서 잠금(_lastReservationLock)으로 동시 생성 방지
 *   - 같은 org+vehicle+date 시간 겹침 검사
 */
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const db = getFirestore();

export interface CreateReservationInput {
    organizationId: string;
    vehicleId: string;
    vehicleName?: string;
    reservedByName?: string;
    date: string;
    startTime: string;
    endTime: string;
    purpose?: string;
    destination?: string;
    routeDistance?: number | null;
    routeDuration?: number | null;
    routeTollFee?: number | null;
    groupId?: string;
    recurringGroupId?: string;
    source?: string;
    /** 예약을 생성하는 실제 사용자 UID (reservedByUid로 기록) */
    actorUid: string;
    /** 호출자의 소속 기관 ID — organizationId와 불일치 시 거부 */
    actorOrgId?: string;
}

export interface CreateReservationResult {
    reservationId: string;
    status: "pending" | "reserved";
}

export async function createReservationTx(
    input: CreateReservationInput
): Promise<CreateReservationResult> {
    const {
        organizationId,
        vehicleId,
        vehicleName,
        reservedByName,
        date,
        startTime,
        endTime,
        purpose,
        destination,
        routeDistance,
        routeDuration,
        routeTollFee,
        groupId,
        recurringGroupId,
        source,
        actorUid,
    } = input;

    if (!organizationId || !vehicleId || !date || !startTime || !endTime) {
        throw new HttpsError(
            "invalid-argument",
            "organizationId, vehicleId, date, startTime, endTime은 필수입니다."
        );
    }

    // 호출자가 해당 기관에 소속되어 있는지 검증 (조직 격리)
    if (input.actorOrgId !== organizationId) {
        throw new HttpsError(
            "permission-denied",
            "자기 기관의 차량만 예약할 수 있습니다."
        );
    }

    if (startTime >= endTime) {
        throw new HttpsError(
            "invalid-argument",
            "시작 시간은 종료 시간보다 빨라야 합니다."
        );
    }

    try {
        return await db.runTransaction(async (transaction) => {
            // 부모 차량 문서를 읽고 의도적으로 업데이트하여 해당 차량의 트랜잭션 Lock 획득 강제 (동시 예약 생성 방지)
            const vehicleRef = db.collection("vehicles").doc(vehicleId);
            const vehicleSnap = await transaction.get(vehicleRef);

            // 차량이 실제로 호출자 기관 소속인지 검증 (교차 테넌트 차량 문서 무단 쓰기 차단 — 2026-07-04 감사 N3)
            if (!vehicleSnap.exists || vehicleSnap.data()?.organizationId !== organizationId) {
                throw new HttpsError("permission-denied", "자기 기관의 차량만 예약할 수 있습니다.");
            }

            // 차량별 사용 가능 직원 제한 검증 (allowedUserIds 없거나 빈 배열 = 전체 허용, 역할 무관 목록 기준)
            const allowedUserIds = vehicleSnap.data()?.allowedUserIds;
            if (
                Array.isArray(allowedUserIds) && allowedUserIds.length > 0 &&
                !allowedUserIds.includes(actorUid)
            ) {
                throw new HttpsError("permission-denied", "이 차량은 지정된 직원만 예약할 수 있습니다.");
            }

            const orgRef = db.collection("organizations").doc(organizationId);
            const orgSnap = await transaction.get(orgRef);
            const requireReservationApproval = orgSnap.exists ? (orgSnap.data()?.requireReservationApproval || false) : false;

            const existingSnap = await transaction.get(
                db.collection("reservations")
                    .where("organizationId", "==", organizationId)
                    .where("vehicleId", "==", vehicleId)
                    .where("date", "==", date)
            );

            const overlapping = existingSnap.docs.find((doc) => {
                const r = doc.data();
                if (r.status === "cancelled") return false;

                const effStart = (r.status === "completed" && r.actualStartTime) ? r.actualStartTime : r.startTime;
                const effEnd = (r.status === "completed" && r.actualEndTime) ? r.actualEndTime : r.endTime;

                return startTime < effEnd && endTime > effStart;
            });

            if (overlapping) {
                const r = overlapping.data();
                const effStart = (r.status === "completed" && r.actualStartTime) ? r.actualStartTime : r.startTime;
                const effEnd = (r.status === "completed" && r.actualEndTime) ? r.actualEndTime : r.endTime;
                throw new HttpsError(
                    "already-exists",
                    `해당 차량은 ${effStart} ~ ${effEnd}에 이미 예약되어 있습니다.`
                );
            }

            // 모든 읽기 작업(get)이 종료된 후 쓰기 작업(update, set)을 수행 (Firestore Transaction 제약조건)
            transaction.update(vehicleRef, { _lastReservationLock: FieldValue.serverTimestamp() });

            const status: "pending" | "reserved" = requireReservationApproval ? "pending" : "reserved";
            const newRef = db.collection("reservations").doc();
            transaction.set(newRef, {
                organizationId,
                vehicleId,
                vehicleName: vehicleName || "",
                reservedByUid: actorUid,
                reservedByName: reservedByName || "",
                date,
                startTime,
                endTime,
                purpose: purpose || "",
                destination: destination || "",
                routeDistance: routeDistance || null,
                routeDuration: routeDuration || null,
                routeTollFee: routeTollFee || null,
                ...(groupId ? { groupId } : {}),
                ...(recurringGroupId ? { recurringGroupId } : {}),
                ...(source ? { source } : {}),
                status,
                createdAt: FieldValue.serverTimestamp(),
            });

            return { reservationId: newRef.id, status };
        });
    } catch (err: unknown) {
        if (err instanceof HttpsError) throw err;
        console.error("createReservationTx 실패:", (err as Error).message);
        throw new HttpsError("internal", "예약 생성에 실패했습니다.");
    }
}
