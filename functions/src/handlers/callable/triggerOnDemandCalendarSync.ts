import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { syncSingleVehicleCalendar } from "../scheduled/calendarSchedule";

const db = getFirestore();

export const triggerOnDemandCalendarSync = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 60,
        memory: "512MiB",
        enforceAppCheck: false,
        cors: [
            "https://vehicle-drive-log.web.app",
            "https://vehicle-drive-log.firebaseapp.com",
            "http://localhost:5173",
        ],
    },
    async (request) => {
        // 1. 로그인 인증 검증
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const uid = request.auth.uid;
        const data = request.data as { vehicleId?: string; organizationId?: string };
        const vehicleId = data.vehicleId;
        const organizationId = data.organizationId;

        if (!vehicleId || !organizationId) {
            throw new HttpsError(
                "invalid-argument",
                "vehicleId와 organizationId는 필수 항목입니다."
            );
        }

        // 2. 권한 검증 (D10 격리)
        // 호출자의 Custom Claims에서 organizationId 검증
        let callerOrgId = request.auth.token.organizationId || request.auth.token.orgId;

        // Custom Claims에 없으면 Firestore users/{uid} 문서에서 organizationId 확인
        if (!callerOrgId) {
            try {
                const userDoc = await db.collection("users").doc(uid).get();
                if (userDoc.exists) {
                    callerOrgId = userDoc.data()?.organizationId;
                }
            } catch (err: unknown) {
                console.error("[OnDemandSync] User doc lookup failed:", (err as Error).message);
                throw new HttpsError("internal", "사용자 정보 조회 중 오류가 발생했습니다.");
            }
        }

        // 요청의 organizationId와 호출자의 organizationId가 일치하는지 철저히 검증
        if (!callerOrgId || callerOrgId !== organizationId) {
            throw new HttpsError(
                "permission-denied",
                "요청한 조직에 대한 동기화 권한이 없습니다."
            );
        }

        // 3. 차량 정보 조회 및 더블 검증
        let vehicleData: any;
        try {
            const vehicleDoc = await db.collection("vehicles").doc(vehicleId).get();
            if (!vehicleDoc.exists) {
                throw new HttpsError("not-found", "해당 차량을 찾을 수 없습니다.");
            }
            vehicleData = vehicleDoc.data();
        } catch (err: unknown) {
            if (err instanceof HttpsError) throw err;
            console.error("[OnDemandSync] Vehicle lookup failed:", (err as Error).message);
            throw new HttpsError("internal", "차량 정보 조회 중 오류가 발생했습니다.");
        }

        // 차량이 요청된 organizationId에 속해 있는지 철저히 검증 (D10)
        if (!vehicleData || vehicleData.organizationId !== organizationId) {
            throw new HttpsError(
                "permission-denied",
                "해당 차량에 대한 동기화 권한이 없습니다. (조직 불일치)"
            );
        }

        const calendarId = vehicleData.googleCalendarId;
        if (!calendarId || !calendarId.includes("@")) {
            throw new HttpsError(
                "failed-precondition",
                "해당 차량은 구글 캘린더가 연동되어 있지 않습니다."
            );
        }

        // 4. 동기화 핵심 로직 수행
        try {
            console.log(`[OnDemandSync] Triggering on-demand sync for vehicle ${vehicleId} in org ${organizationId}`);
            
            const result = await syncSingleVehicleCalendar(vehicleId, vehicleData);
            
            return {
                success: true,
                message: "구글 캘린더 동기화가 완료되었습니다.",
                stats: result,
            };
        } catch (err: unknown) {
            console.error(`[OnDemandSync] Sync execution failed for vehicle ${vehicleId}:`, (err as Error).message);
            throw new HttpsError(
                "internal",
                `캘린더 동기화 실행 중 오류가 발생했습니다: ${(err as Error).message}`
            );
        }
    }
);
