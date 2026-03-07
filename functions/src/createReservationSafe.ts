/**
 * createReservationSafe — Firestore Transaction으로 예약 중복 방지
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const db = getFirestore();

export const createReservationSafe = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const {
            organizationId,
            vehicleId,
            vehicleName,
            reservedByUid,
            reservedByName,
            date,
            startTime,
            endTime,
            purpose,
            destination,
            routeDistance,
            routeDuration,
            routeTollFee,
        } = request.data;

        if (!organizationId || !vehicleId || !date || !startTime || !endTime) {
            throw new HttpsError(
                "invalid-argument",
                "organizationId, vehicleId, date, startTime, endTime은 필수입니다."
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
                const existingSnap = await transaction.get(
                    db.collection("reservations")
                        .where("organizationId", "==", organizationId)
                        .where("vehicleId", "==", vehicleId)
                        .where("date", "==", date)
                );

                const overlapping = existingSnap.docs.find((doc) => {
                    const r = doc.data();
                    if (r.status === "cancelled" || r.status === "completed") return false;
                    return startTime < r.endTime && endTime > r.startTime;
                });

                if (overlapping) {
                    const r = overlapping.data();
                    throw new HttpsError(
                        "already-exists",
                        `해당 차량은 ${r.startTime} ~ ${r.endTime}에 이미 예약되어 있습니다.`
                    );
                }

                const newRef = db.collection("reservations").doc();
                transaction.set(newRef, {
                    organizationId,
                    vehicleId,
                    vehicleName: vehicleName || "",
                    reservedByUid: reservedByUid || request.auth!.uid,
                    reservedByName: reservedByName || "",
                    date,
                    startTime,
                    endTime,
                    purpose: purpose || "",
                    destination: destination || "",
                    routeDistance: routeDistance || null,
                    routeDuration: routeDuration || null,
                    routeTollFee: routeTollFee || null,
                    status: "reserved",
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
