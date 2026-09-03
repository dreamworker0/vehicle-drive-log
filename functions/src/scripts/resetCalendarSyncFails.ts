/**
 * resetCalendarSyncFails — calendarSyncFailCount 일괄 리셋 (슈퍼관리자 호출용)
 *
 * calendarSyncFailCount >= 3으로 영구 제외된 차량들을 전부 0으로 리셋하여
 * 다음 syncCalendarToApp 주기에 재시도하게 합니다.
 */
import { onCall } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { log, requireSuperAdmin } from "../utils/helpers";

const db = getFirestore();

export const resetCalendarSyncFails = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 30,
        memory: "256MiB",
        enforceAppCheck: false,
    },
    async (request) => {
        // 인증·슈퍼관리자 권한 확인
        requireSuperAdmin(request);

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

            // 사유·통지 표식도 함께 지운다(resetCalendarFailure와 같은 이유) — 남겨 두면
            // 복구된 차량에 지난 사유가 붙어 있고, 통지 표식 탓에 다음에 다시 끊겼을 때
            // 기관에 알리지 못한다.
            batch.update(doc.ref, {
                calendarSyncFailCount: 0,
                calendarSyncLastFailAt: null,
                calendarSyncLastFailReason: FieldValue.delete(),
                calendarSyncLastFailStatus: FieldValue.delete(),
                calendarSyncDisabledNotifiedAt: FieldValue.delete(),
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
