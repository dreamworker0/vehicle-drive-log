/**
 * testCalendarAccess — 캘린더 접근 테스트 (관리자용)
 *
 * 주어진 Google Calendar ID에 서비스 계정이 접근 가능한지 테스트합니다.
 * 기관 관리자가 캘린더 공유 설정을 올바르게 했는지 즉시 확인할 수 있습니다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { google } from "googleapis";

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
        enforceAppCheck: true,
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
