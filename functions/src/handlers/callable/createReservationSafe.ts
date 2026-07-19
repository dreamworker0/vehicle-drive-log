/**
 * createReservationSafe — Firestore Transaction으로 예약 중복 방지
 *
 * 실제 검증·생성 로직은 services/reservation/createReservationCore.ts에 있고,
 * 이 콜러블은 인증 확인과 actorUid/actorOrgId 주입만 담당하는 얇은 래퍼다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { createReservationTx } from "../../services/reservation/createReservationCore";

export const createReservationSafe = onCall(
    { region: "asia-northeast3", enforceAppCheck: true },
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

        const { reservationId } = await createReservationTx({
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
            actorUid: request.auth.uid,
            actorOrgId: request.auth.token.orgId,
        });

        console.log(`Reservation created safely: ${reservationId} (${vehicleName}, ${date} ${startTime}-${endTime})`);
        return { success: true, reservationId };
    }
);
