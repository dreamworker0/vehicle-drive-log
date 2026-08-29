import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { checkRateLimitByUid, checkRateLimitByIp, checkGlobalBudget } from "../../utils/rateLimit";
import { resolveClientIp } from "../../utils/clientIp";
import { GLOBAL_BUDGETS } from "../../utils/constants";

export const submitPublicFeedback = onCall(
    { 
        region: "asia-northeast3", 
        timeoutSeconds: 30,
        // 의도적으로 끈다 — 랜딩의 공개 문의 모달은 인앱 브라우저에서도 열리는데,
        // 그 환경에서는 App Check가 초기화되지 않는다(submitOrgApplication의 주석 참고).
        // 방어선은 아래 이메일 5회/시간 + IP 10회/시간 Rate Limit이다.
        enforceAppCheck: false,
    },
    async (request) => {
        // 입력 정보 추출
        const { userName, userEmail, message } = request.data;
        
        // 유효성 검사
        if (!userName || typeof userName !== 'string' || userName.trim().length === 0) {
            throw new HttpsError("invalid-argument", "이름을 입력해주세요.");
        }
        const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!userEmail || typeof userEmail !== 'string' || !EMAIL_REGEX.test(userEmail.trim())) {
            throw new HttpsError("invalid-argument", "유효한 이메일 주소를 입력해주세요.");
        }
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            throw new HttpsError("invalid-argument", "문의 내용을 입력해주세요.");
        }
        // 입력 길이 상한 (과도한 문서 페이로드 방지)
        if (userName.length > 100 || message.length > 5000) {
            throw new HttpsError("invalid-argument", "입력 값의 길이가 허용 범위를 초과했습니다.");
        }

        // Rate Limit: 동일 이메일로 1시간에 5회 이상 제출 방지
        const safeEmail = userEmail.trim().toLowerCase();
        await checkRateLimitByUid("submitPublicFeedback", safeEmail, 5, 3600, "closed");

        // IP 기반 상한 — 이메일을 회전시켜 이메일 키 제한을 우회하는 무제한 익명 쓰기 차단 (2026-07-04 감사 N4)
        // IP 추출은 resolveClientIp로 통일한다 — `rawRequest.ip`는 클라이언트가 정하는
        // X-Forwarded-For 맨 앞 값이라 상한이 무의미했다 (2026-08-14 감사 발견 2).
        const clientIp = resolveClientIp(request.rawRequest);
        if (await checkRateLimitByIp("submitPublicFeedback", clientIp, 30, 3600, "closed")) {
            throw new HttpsError("resource-exhausted", "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
        }

        // 전역 예산 — 이 경로로 만들어진 문서는 generateFeedbackDraft(Gemini)를 깨우므로
        // 주체 키를 모두 회전시켰을 때의 마지막 비용 상한이 필요하다 (ocr-cost-security §1.4).
        const budget = GLOBAL_BUDGETS.submitPublicFeedback;
        if (await checkGlobalBudget("submitPublicFeedback", budget.max, budget.windowSec)) {
            throw new HttpsError("resource-exhausted", "지금은 문의가 몰려 접수를 받을 수 없습니다. 잠시 후 다시 시도해주세요.");
        }

        try {
            const db = getFirestore();
            
            await db.collection("feedbacks").add({
                type: 'inquiry', // 퍼블릭 문의 명시
                authorUid: 'public-inquiry', // 익명 처리 (DB 필수 항목 회피)
                userName: userName.trim(),
                userEmail: safeEmail,
                message: message.trim(),
                content: message.trim(), // 호환성을 위해 둘 다 저장
                status: 'unread',
                createdAt: FieldValue.serverTimestamp(),
            });

            return { success: true };
        } catch (error) {
            // Rate limit 에러는 그대로 전파
            if (error instanceof HttpsError) throw error;
            console.error("public feedback error:", error);
            throw new HttpsError("internal", "문의 등록 중 서버 오류가 발생했습니다.");
        }
    }
);
