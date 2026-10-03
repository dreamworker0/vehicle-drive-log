/**
 * updateReservationSafe — 예약 수정(단건 수정·반복 그룹에서 떼어내기)
 *
 * 실제 검증·수정 로직은 services/reservation/updateReservationCore.ts에 있고,
 * 이 콜러블은 인증 확인과 actorUid/actorOrgId/actorRole 주입만 담당하는 얇은 래퍼다.
 * 입력은 코어가 받는 필드만 골라 넘긴다 — 화면이 보낸 나머지 필드는 문서에 닿지 않는다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { updateReservationTx } from "../../services/reservation/updateReservationCore";

export const updateReservationSafe = onCall(
    { region: "asia-northeast3", enforceAppCheck: true },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const {
            reservationId,
            vehicleId,
            date,
            startTime,
            endTime,
            reservedByUid,
            vehicleName,
            reservedByName,
            purpose,
            destination,
            routeDistance,
            routeDuration,
            routeTollFee,
            passengerUids,
            passengerNames,
            passengerCount,
            detachRecurring,
            groupId,
        } = request.data ?? {};

        const result = await updateReservationTx({
            reservationId,
            vehicleId,
            date,
            startTime,
            endTime,
            reservedByUid,
            vehicleName,
            reservedByName,
            purpose,
            destination,
            routeDistance,
            routeDuration,
            routeTollFee,
            passengerUids,
            passengerNames,
            passengerCount,
            detachRecurring: detachRecurring === true,
            groupId,
            actorUid: request.auth.uid,
            actorOrgId: request.auth.token.orgId,
            actorRole: request.auth.token.role,
        });

        return { success: true, ...result };
    }
);
