/**
 * createReservationSafe — Firestore Transaction으로 예약 중복 방지
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const db = getFirestore();

export const createReservationSafe = onCall(
    { region: "asia-northeast3", enforceAppCheck: false },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

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
        } = request.data;

        if (!organizationId || !vehicleId || !date || !startTime || !endTime) {
            throw new HttpsError(
                "invalid-argument",
                "organizationId, vehicleId, date, startTime, endTime은 필수입니다."
            );
        }

        // 호출자가 해당 기관에 소속되어 있는지 검증 (조직 격리)
        const callerOrgId = request.auth.token.orgId;
        if (callerOrgId !== organizationId) {
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
            const reservationId = await db.runTransaction(async (transaction) => {
                // 부모 차량 문서를 읽고 의도적으로 업데이트하여 해당 차량의 트랜잭션 Lock 획득 강제 (동시 예약 생성 방지)
                const vehicleRef = db.collection("vehicles").doc(vehicleId);
                const vehicleSnap = await transaction.get(vehicleRef);

                // 차량이 실제로 호출자 기관 소속인지 검증 (교차 테넌트 차량 문서 무단 쓰기 차단 — 2026-07-04 감사 N3)
                if (!vehicleSnap.exists || vehicleSnap.data()?.organizationId !== organizationId) {
                    throw new HttpsError("permission-denied", "자기 기관의 차량만 예약할 수 있습니다.");
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

                const newRef = db.collection("reservations").doc();
                transaction.set(newRef, {
                    organizationId,
                    vehicleId,
                    vehicleName: vehicleName || "",
                    reservedByUid: request.auth!.uid,
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
                    status: requireReservationApproval ? "pending" : "reserved",
                    createdAt: FieldValue.serverTimestamp(),
                });

                return newRef.id;
            });

            console.log(`Reservation created safely: ${reservationId} (${vehicleName}, ${date} ${startTime}-${endTime})`);
            return { success: true, reservationId };
        } catch (err: unknown) {
            if (err instanceof HttpsError) throw err;
            console.error("createReservationSafe 실패:", (err as Error).message);
            throw new HttpsError("internal", "예약 생성에 실패했습니다.");
        }
    }
);
