/**
 * createReservationCore — 예약 생성의 권위(authoritative) 코어 로직
 *
 * createReservationSafe 콜러블에서 추출한 트랜잭션 본문.
 * 호출 경로(콜러블·Slack 어시스턴트 등)와 무관하게 동일한 검증을 강제한다:
 *   - 조직 격리 (actorOrgId === organizationId, 차량 문서 org 일치)
 *   - 차량별 사용 가능 직원 제한 (allowedUserIds)
 *   - 차량 문서 잠금(_lastReservationLock)으로 동시 생성 방지
 *   - 같은 org+vehicle+date 시간 겹침 검사
 *   - 같은 org+명의자+date 시간 겹침 검사 (한 사람은 같은 시간에 한 대만)
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
    /** 예약을 생성하는 실제 사용자 UID (reservedByUid를 지정하지 않으면 이 값이 명의가 된다) */
    actorUid: string;
    /** 호출자의 소속 기관 ID — organizationId와 불일치 시 거부 */
    actorOrgId?: string;
    /** 호출자의 역할 (Custom Claims) — 대리 생성 권한 판정에만 쓴다 */
    actorRole?: string;
    /**
     * 예약 명의자 UID. 생략하면 호출자 자신이다.
     *
     * 호출자와 다른 값은 **기관 관리자만** 지정할 수 있고, 대상이 같은 기관 구성원인지
     * 트랜잭션 안에서 다시 확인한다. 이 입구가 없던 동안은 명의가 항상 호출자로 강제됐고,
     * 그래서 관리자가 직원의 그룹 예약(다일·반복)을 수정하면 — 그 경로는 "지우고 다시
     * 만들기"다 — **직원 예약이 관리자 명의로 조용히 넘어갔다.** Rules가 관리자의 예약
     * 삭제를 막아 온 이유가 이것이었다.
     */
    reservedByUid?: string;
    /**
     * 예약 시점에 미리 적어 두는 동승자(예정). 확정 기록은 운행일지이며,
     * 여기 값은 운행일지 작성 화면의 초기값으로만 쓰인다.
     */
    passengerUids?: string[];
    passengerNames?: string[];
    passengerCount?: number;
}

/** 동승자 배열 길이 상한 — 클라이언트(reservationPassengers.ts)와 같은 값 */
const MAX_PASSENGERS = 50;

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
        actorRole,
        reservedByUid,
        passengerUids,
        passengerNames,
        passengerCount,
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

    // 명의자 — 지정이 없으면 호출자 자신이다.
    // 남의 명의를 지정하는 것은 기관 관리자만 할 수 있다(직원 예약 대행·그룹 수정).
    const ownerUid = reservedByUid || actorUid;
    const isOnBehalf = ownerUid !== actorUid;
    if (isOnBehalf && actorRole !== "admin") {
        throw new HttpsError(
            "permission-denied",
            "다른 직원 명의의 예약은 기관 관리자만 만들 수 있습니다."
        );
    }

    if (startTime >= endTime) {
        throw new HttpsError(
            "invalid-argument",
            "시작 시간은 종료 시간보다 빨라야 합니다."
        );
    }

    // 동승자(예정) 정규화 — 길이 상한을 두는 이유는 문서 크기와 읽기 비용이다.
    // 무제한 배열은 예약 목록을 읽는 모든 화면의 비용을 함께 키운다.
    if ((passengerUids?.length || 0) > MAX_PASSENGERS || (passengerNames?.length || 0) > MAX_PASSENGERS) {
        throw new HttpsError(
            "invalid-argument",
            `동승자는 최대 ${MAX_PASSENGERS}명까지 지정할 수 있습니다.`
        );
    }
    if (passengerCount !== undefined && (!Number.isInteger(passengerCount) || passengerCount < 0)) {
        throw new HttpsError("invalid-argument", "동승 인원은 0 이상의 정수여야 합니다.");
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

            // 대리 생성이면 명의자가 실제로 같은 기관 구성원인지 확인한다.
            // Claims의 role만 믿고 통과시키면 관리자가 임의 UID(타 기관·존재하지 않는 계정)
            // 명의로 예약을 심을 수 있다. 모든 읽기는 쓰기 전에 끝내야 하므로 여기서 읽는다.
            if (isOnBehalf) {
                const ownerSnap = await transaction.get(db.collection("users").doc(ownerUid));
                if (!ownerSnap.exists || ownerSnap.data()?.organizationId !== organizationId) {
                    throw new HttpsError(
                        "permission-denied",
                        "같은 기관 구성원 명의로만 예약할 수 있습니다."
                    );
                }
            }

            // 차량별 사용 가능 직원 제한 검증 (allowedUserIds 없거나 빈 배열 = 전체 허용, 역할 무관 목록 기준)
            // 판정 기준은 호출자가 아니라 **명의자**다 — 제한은 "누가 이 차를 쓰는가"에 대한 것이고,
            // 대리 생성에서 실제 운행자는 명의자다.
            const allowedUserIds = vehicleSnap.data()?.allowedUserIds;
            if (
                Array.isArray(allowedUserIds) && allowedUserIds.length > 0 &&
                !allowedUserIds.includes(ownerUid)
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

            // 사람 기준 겹침 — **한 사람은 같은 시간에 차량 한 대만** 예약한다.
            // 한 사람이 두 대를 동시에 몰 수는 없고, 여러 대를 잡아 두면 정작 필요한
            // 사람이 예약하지 못한다. 여러 대가 필요한 행사라면 실제로 운전할 사람
            // 명의로 각각 잡는다.
            //
            // 그룹 수정(다일·반복)은 "지우고 다시 만들기" 경로라 재생성 시점에는 옛 회차가
            // 이미 사라져 있다. 따라서 여기서 자기 그룹을 따로 제외할 필요가 없다.
            const ownerSnap = await transaction.get(
                db.collection("reservations")
                    .where("organizationId", "==", organizationId)
                    .where("reservedByUid", "==", ownerUid)
                    .where("date", "==", date)
            );

            const ownerOverlapping = ownerSnap.docs.find((doc) => {
                const r = doc.data();
                if (r.status === "cancelled") return false;

                const effStart = (r.status === "completed" && r.actualStartTime) ? r.actualStartTime : r.startTime;
                const effEnd = (r.status === "completed" && r.actualEndTime) ? r.actualEndTime : r.endTime;

                return startTime < effEnd && endTime > effStart;
            });

            if (ownerOverlapping) {
                const r = ownerOverlapping.data();
                const effStart = (r.status === "completed" && r.actualStartTime) ? r.actualStartTime : r.startTime;
                const effEnd = (r.status === "completed" && r.actualEndTime) ? r.actualEndTime : r.endTime;
                throw new HttpsError(
                    "already-exists",
                    `${r.reservedByName || "예약자"}님은 ${effStart} ~ ${effEnd}에 ${r.vehicleName || "다른 차량"} 예약이 있습니다. ` +
                    "한 사람은 같은 시간에 한 대만 예약할 수 있습니다."
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
                reservedByUid: ownerUid,
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
                // 빈 값은 필드를 만들지 않는다 (문서를 불필요하게 키우지 않는다)
                ...(passengerUids?.length ? { passengerUids } : {}),
                ...(passengerNames?.length ? { passengerNames } : {}),
                ...(passengerCount ? { passengerCount } : {}),
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
