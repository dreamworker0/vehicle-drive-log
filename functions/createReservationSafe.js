/**
 * 예약 생성 (중복 방지) — onCall Cloud Function
 * Firestore Transaction으로 시간 겹침을 원자적으로 검증 후 예약 생성
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const db = getFirestore();

exports.createReservationSafe = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        // 인증 확인
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

        // 필수 필드 검증
        if (!organizationId || !vehicleId || !date || !startTime || !endTime) {
            throw new HttpsError(
                "invalid-argument",
                "organizationId, vehicleId, date, startTime, endTime은 필수입니다."
            );
        }

        // 시간 순서 검증
        if (startTime >= endTime) {
            throw new HttpsError(
                "invalid-argument",
                "시작 시간은 종료 시간보다 빨라야 합니다."
            );
        }

        try {
            const reservationId = await db.runTransaction(async (transaction) => {
                // 같은 기관 + 같은 차량 + 같은 날짜의 기존 예약 조회
                const existingSnap = await transaction.get(
                    db.collection("reservations")
                        .where("organizationId", "==", organizationId)
                        .where("vehicleId", "==", vehicleId)
                        .where("date", "==", date)
                );

                // 시간 겹침 검사 (cancelled, completed 제외)
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

                // 예약 문서 생성
                const newRef = db.collection("reservations").doc();
                transaction.set(newRef, {
                    organizationId,
                    vehicleId,
                    vehicleName: vehicleName || "",
                    reservedByUid: reservedByUid || request.auth.uid,
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
        } catch (err) {
            // HttpsError는 그대로 전달
            if (err instanceof HttpsError) throw err;
            console.error("createReservationSafe 실패:", err.message);
            throw new HttpsError("internal", "예약 생성에 실패했습니다.");
        }
    }
);
