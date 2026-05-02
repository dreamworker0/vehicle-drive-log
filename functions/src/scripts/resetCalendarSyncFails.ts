/**
 * resetCalendarSyncFails — calendarSyncFailCount 일괄 리셋 (슈퍼관리자 호출용)
 *
 * calendarSyncFailCount >= 3으로 영구 제외된 차량들을 전부 0으로 리셋하여
 * 다음 syncCalendarToApp 주기에 재시도하게 합니다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { log } from "../helpers";

const db = getFirestore();

export const resetCalendarSyncFails = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 30,
        memory: "256MiB",
        enforceAppCheck: false,
    },
    async (request) => {
        // 인증 확인
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        // 슈퍼관리자 권한 확인
        if (request.auth.token.role !== "superAdmin") {
            throw new HttpsError("permission-denied", "시스템 관리자만 사용할 수 있습니다.");
        }

        log("INFO", "resetCalendarSyncFails", "캘린더 동기화 실패 카운터 리셋 시작", {
            uid: request.auth.uid,
        });

        // calendarSyncFailCount > 0인 차량 조회
        const vehiclesSnap = await db.collection("vehicles")
            .where("calendarSyncFailCount", ">", 0)
            .get();

        if (vehiclesSnap.empty) {
            return { resetCount: 0, message: "리셋할 차량이 없습니다." };
        }

        const batch = db.batch();
        const resetVehicles: { name: string; previousFailCount: number }[] = [];

        for (const doc of vehiclesSnap.docs) {
            const data = doc.data();
            resetVehicles.push({
                name: (data.displayName as string) || doc.id,
                previousFailCount: (data.calendarSyncFailCount as number) || 0,
            });

            batch.update(doc.ref, {
                calendarSyncFailCount: 0,
                calendarSyncLastFailAt: null,
            });
        }

        await batch.commit();

        log("INFO", "resetCalendarSyncFails", "리셋 완료", {
            resetCount: resetVehicles.length,
            vehicles: resetVehicles,
        });

        return {
            resetCount: resetVehicles.length,
            vehicles: resetVehicles,
            message: `${resetVehicles.length}대 차량의 동기화 실패 카운터를 리셋했습니다.`,
        };
    }
);
