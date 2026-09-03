import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { syncSingleVehicleCalendar } from "../scheduled/calendarSchedule";
import { isCalendarAuthError, recordCalendarFailure, resetCalendarFailure, shouldSkipVehicleCalendar, MAX_FAIL_COUNT } from "../../services/calendar/calendarFailTracking";
import { checkRateLimitBySubject } from "../../utils/rateLimit";
import { getRateLimits } from "../../utils/constants";

const db = getFirestore();

export const triggerOnDemandCalendarSync = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 60,
        memory: "512MiB",
        // App Check는 의도적으로 강제하지 않는다 — 이 함수는 캘린더 연결 문제를
        // 진단·복구하는 경로라, App Check 실패가 원인을 가리는 부작용이 더 크다.
        // (근거와 함께 scripts/__tests__/enforceAppCheckInvariant.test.ts의
        //  PENDING_DECISION에 고정돼 있다.) 남용·비용 방어는 아래 3-2의 빈도 제한이 맡는다.
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
        let vehicleData: FirebaseFirestore.DocumentData | undefined;
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

        // 3-1. 실패 누적(쿨다운/영구제외) 차량은 동기화 호출 자체를 건너뛴다.
        // 이 콜러블은 예약 캘린더를 열 때마다 백그라운드로 자동 호출되므로
        // (useReservationData), 공유가 깨진 차량은 가드가 없으면 매번 403/404를 유발해
        // 쿼터를 낭비하고 calendarSyncFailCount가 MAX를 넘어 무한 증가한다.
        // errorType은 클라이언트가 30분 쿨다운을 적용하고 조용히 멈추도록 기존 값을 재사용한다.
        const failCount = (vehicleData.calendarSyncFailCount as number) || 0;
        if (shouldSkipVehicleCalendar(vehicleData)) {
            console.log(`[OnDemandSync] Vehicle ${vehicleId}: calendar sync disabled (failCount=${failCount}), skip`);
            return {
                success: false,
                errorType: "calendar-not-found",
                message: failCount >= MAX_FAIL_COUNT
                    ? "캘린더 동기화가 반복 실패로 중단된 차량입니다. 공유 설정을 정정한 뒤 헬스 체크에서 '동기화 리셋'을 해주세요."
                    : "캘린더 동기화가 일시 중단(쿨다운) 상태입니다. 잠시 후 다시 시도됩니다.",
            };
        }

        // 3-2. 호출 빈도 제한 — 이 콜러블은 예약 캘린더를 열 때마다 백그라운드로 자동
        // 호출된다(위 3-1 주석). 30분 쿨다운이 useCalendarSync의 브라우저 저장소에만
        // 있었으므로, 기기·사용자가 늘면 같은 차량의 캘린더를 30분 안에 몇 번이고
        // 다시 긁었다(호출 1건 = Google Calendar API 조회 + 예약 범위 쿼리).
        //
        // 두 키를 함께 본다 (ocr-cost-security §1.1의 이중 키):
        //   차량 키 — 클라이언트 쿨다운을 서버로 옮긴다. 한 기관 직원 열 명이 동시에
        //             예약 화면을 열어도 그 차량 동기화는 창당 상한까지만 돈다.
        //   uid 키 — 자기 기관 차량을 돌려가며 호출하는 경로를 막는다.
        //
        // 초과 시 **예외를 던지지 않는다.** 던지면 useCalendarSync가 3회 재시도해
        // 호출이 오히려 늘어난다. 3-1과 같은 소프트 스킵을 돌려주어 클라이언트가
        // 쿨다운을 적용하고 조용히 멈추게 한다 — 자동 호출 경로라 사용자에게
        // 보일 이유도 없다. 놓친 변경은 30분 주기 스케줄러가 따라잡는다.
        const rateLimited = async (): Promise<string | null> => {
            // 차량 키를 먼저 본다. 여기서 막히면 uid 카운터는 올리지 않는다 —
            // 이미 거절할 요청에 _rateLimits 트랜잭션을 한 번 더 쓸 이유가 없다.
            const vehicleLimit = await getRateLimits("onDemandCalendarSyncVehicle");
            if (await checkRateLimitBySubject(
                "triggerOnDemandCalendarSync:vehicle", vehicleId, vehicleLimit.max, vehicleLimit.windowSec, "closed",
            )) return "vehicle";

            // checkRateLimitByUid가 아니라 공통 구현을 쓴다 — 전자는 초과 시
            // HttpsError를 던지는데, 여기서는 던지면 안 된다(클라이언트가 재시도한다).
            const uidLimit = await getRateLimits("onDemandCalendarSync");
            if (await checkRateLimitBySubject(
                "triggerOnDemandCalendarSync", uid, uidLimit.max, uidLimit.windowSec, "closed",
            )) return "uid";

            return null;
        };

        const limitedBy = await rateLimited();
        if (limitedBy) {
            console.log(`[OnDemandSync] Vehicle ${vehicleId}: rate limited by ${limitedBy}, skip`);
            return {
                success: false,
                errorType: "rate-limited",
                message: "최근에 동기화했습니다. 잠시 후 자동으로 다시 반영됩니다.",
            };
        }

        // 4. 동기화 핵심 로직 수행
        try {
            console.log(`[OnDemandSync] Triggering on-demand sync for vehicle ${vehicleId} in org ${organizationId}`);

            const result = await syncSingleVehicleCalendar(vehicleId, vehicleData);

            // 동기화 성공 시 실패 카운터 리셋
            if ((vehicleData.calendarSyncFailCount || 0) > 0) {
                await resetCalendarFailure(vehicleId);
            }

            return {
                success: true,
                message: "구글 캘린더 동기화가 완료되었습니다.",
                stats: result,
            };
        } catch (err: unknown) {
            const errMsg = (err as Error).message;
            console.error(`[OnDemandSync] Sync execution failed for vehicle ${vehicleId}:`, errMsg);

            // 캘린더 미존재/공유 권한 누락(404/403)은 "사용자 설정 오류"인 예상된 상태이다.
            // 500(internal)으로 던지면 콘솔·모니터링에 서버 장애처럼 노이즈가 쌓이므로,
            // (1) 실패 카운터를 올려 관리자 차량 목록에 '동기화 실패' 배지가 뜨게 하고,
            // (2) 에러가 아닌 정상 응답(success:false)으로 반환해 클라이언트가 조용히 재시도를 멈추게 한다.
            if (isCalendarAuthError(err)) {
                try {
                    await recordCalendarFailure(vehicleId, (vehicleData.calendarSyncFailCount as number) || 0, err);
                } catch (updateErr: unknown) {
                    console.error(`[OnDemandSync] Failed to record sync failure for ${vehicleId}:`, (updateErr as Error).message);
                }
                return {
                    success: false,
                    errorType: "calendar-not-found",
                    message: "캘린더에 접근할 수 없습니다. 구글 캘린더가 서비스 계정에 '변경 권한'으로 공유되어 있는지 확인해주세요.",
                };
            }

            // 그 외의 실제 오류는 기존대로 internal 에러로 던져 클라이언트가 재시도하게 한다.
            throw new HttpsError(
                "internal",
                `캘린더 동기화 실행 중 오류가 발생했습니다: ${errMsg}`
            );
        }
    }
);
