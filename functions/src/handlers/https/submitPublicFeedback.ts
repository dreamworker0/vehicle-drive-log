import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import * as admin from 'firebase-admin';
import { checkRateLimitByUid, checkRateLimitByIp } from "../../utils/rateLimit";

export const submitPublicFeedback = onCall(
    { 
        region: "asia-northeast3", 
        timeoutSeconds: 30,
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
        await checkRateLimitByUid("submitPublicFeedback", safeEmail, 5, 3600);

        // IP 기반 상한 — 이메일을 회전시켜 이메일 키 제한을 우회하는 무제한 익명 쓰기 차단 (2026-07-04 감사 N4)
        const clientIp = request.rawRequest?.ip
            || (request.rawRequest?.headers["x-forwarded-for"] as string)
            || "unknown";
        if (await checkRateLimitByIp("submitPublicFeedback", clientIp, 10, 3600)) {
            throw new HttpsError("resource-exhausted", "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
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
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
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
