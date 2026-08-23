/**
 * testCalendarAccess — 캘린더 접근 테스트 (관리자용)
 *
 * 주어진 Google Calendar ID에 서비스 계정이 접근 가능한지 테스트합니다.
 * 기관 관리자가 캘린더 공유 설정을 올바르게 했는지 즉시 확인할 수 있습니다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { google } from "googleapis";
import { getCalendarBindingOwner } from "../../services/calendar/calendarBinding";
import { checkRateLimitByUid } from "../../utils/rateLimit";
import { getRateLimits } from "../../utils/constants";

/** 에러 유형별 사용자 친화적 메시지 */
const ERROR_MESSAGES: Record<string, { type: string; title: string; message: string }> = {
    "403": {
        type: "FORBIDDEN",
        title: "캘린더 접근 권한 없음",
        message: "서비스 계정에 캘린더 공유가 설정되지 않았습니다. 구글 캘린더 설정에서 서비스 계정 이메일을 '일정 변경' 권한으로 추가해주세요.",
    },
    "404": {
        type: "NOT_FOUND",
        title: "캘린더를 찾을 수 없음",
        message: "입력한 캘린더 ID가 올바르지 않거나 삭제된 캘린더입니다. 캘린더 설정 → 캘린더 통합에서 캘린더 ID를 다시 확인해주세요.",
    },
};

export const testCalendarAccess = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 15,
        memory: "256MiB",
        enforceAppCheck: false,
        cors: true,
    },
    async (request) => {
        // 인증 확인
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        // 관리자 이상 권한 확인
        const role = request.auth.token.role as string;
        if (role !== "admin" && role !== "superAdmin") {
            throw new HttpsError("permission-denied", "관리자만 사용할 수 있습니다.");
        }

        const calendarId = request.data?.calendarId as string;
        if (!calendarId || !calendarId.trim()) {
            throw new HttpsError("invalid-argument", "캘린더 ID가 필요합니다.");
        }

        // 이 함수는 임의의 캘린더 ID에 대해 "서비스 계정이 접근할 수 있는가"를 알려준다.
        // 그 대답은 진단에 필요하지만, 상한이 없으면 **후보 ID를 훑는 오라클**이 된다
        // (2026-08-23 감사 발견 1의 정찰 도구). 정상 진단은 몇 번 눌러 끝나므로
        // 시간당 상한으로 열거만 잘라낸다. fail-open 기본값 — 진단 도구를 한도 조회
        // 실패로 막지 않는다(남용 방어의 본선은 아래 바인딩 검사다).
        const limit = await getRateLimits("testCalendarAccess");
        await checkRateLimitByUid("testCalendarAccess", request.auth.uid, limit.max, limit.windowSec);

        // 이미 다른 기관에 귀속된 캘린더는 접근 여부를 알려주지 않는다. 알려주면 그 자체로
        // "이 ID는 이 서비스가 읽을 수 있다"는 확인이 되고, 등록해도 동기화는 어차피 막힌다.
        //
        // superAdmin은 예외다 — 기관을 대신해 연동 문제를 진단하는 운영자이고, orgId 클레임이
        // 없어서(기관 미소속) 이 검사를 그대로 적용하면 **모든 등록된 캘린더**를 진단할 수
        // 없게 된다. 진단 대상 기관을 고르는 화면 자체가 superAdmin 전용이다.
        // 공유 대상인 서비스 계정 주소를 캘린더 ID로 넣는 오독이 실제로 있었다(2026-08-23 시딩에서
        // 3개 기관 발견). 접근 테스트를 돌리기 전에 원인을 그대로 알려 준다.
        if (calendarId.trim().toLowerCase().endsWith(".gserviceaccount.com")) {
            return {
                success: false,
                errorType: "SERVICE_ACCOUNT_ADDRESS",
                errorTitle: "캘린더 ID가 아니라 공유 대상 주소입니다",
                message: "입력한 값은 캘린더를 공유해 줄 서비스 계정 주소입니다. 그 주소는 '공유' 대상에만 넣고, 이 칸에는 구글 캘린더 설정 → 캘린더 통합에 있는 '캘린더 ID'를 넣어주세요.",
            };
        }

        const callerOrgId = (request.auth.token.orgId || request.auth.token.organizationId) as string | undefined;
        const owner = role === "superAdmin" ? null : await getCalendarBindingOwner(calendarId);
        if (owner && owner !== callerOrgId) {
            return {
                success: false,
                errorType: "BOUND_TO_OTHER_ORG",
                errorTitle: "다른 기관이 사용 중인 캘린더",
                message: "이미 다른 기관에 등록된 캘린더 ID입니다. 우리 기관 전용 캘린더 ID를 입력해주세요.",
            };
        }

        try {
            // ADC(Application Default Credentials)로 인증
            const auth = new google.auth.GoogleAuth({
                scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
            });
            const calendar = google.calendar({ version: "v3", auth });

            // 이벤트 1건만 조회하여 접근 가능 여부 테스트
            const now = new Date();
            await calendar.events.list({
                calendarId: calendarId.trim(),
                timeMin: now.toISOString(),
                maxResults: 1,
                singleEvents: true,
            });

            return {
                success: true,
                message: "캘린더 접근이 정상적으로 확인되었습니다. 동기화가 정상 작동합니다.",
            };
        } catch (err: unknown) {
            const error = err as { code?: number; message?: string };
            const statusCode = String(error.code || "");
            const errorInfo = ERROR_MESSAGES[statusCode] || {
                type: "UNKNOWN",
                title: "알 수 없는 오류",
                message: `캘린더 접근 중 오류가 발생했습니다: ${error.message || "알 수 없는 오류"}`,
            };

            return {
                success: false,
                errorType: errorInfo.type,
                errorTitle: errorInfo.title,
                message: errorInfo.message,
            };
        }
    }
);
