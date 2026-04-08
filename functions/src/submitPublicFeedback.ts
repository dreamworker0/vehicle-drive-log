import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import * as admin from 'firebase-admin';

export const submitPublicFeedback = onCall(
    { 
        region: "asia-northeast3", 
        timeoutSeconds: 30,
        enforceAppCheck: false // 아직 모든 데스크톱/테스트 환경에서 온전하지 않을 수 있으므로 임시로 끔
    },
    async (request) => {
        // 입력 정보 추출
        const { userName, userEmail, message } = request.data;
        
        // 유효성 검사
        if (!userName || typeof userName !== 'string' || userName.trim().length === 0) {
            throw new HttpsError("invalid-argument", "이름을 입력해주세요.");
        }
        if (!userEmail || typeof userEmail !== 'string' || !userEmail.includes('@')) {
            throw new HttpsError("invalid-argument", "유효한 이메일 주소를 입력해주세요.");
        }
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            throw new HttpsError("invalid-argument", "문의 내용을 입력해주세요.");
        }

        try {
            const db = getFirestore();
            
            await db.collection("feedbacks").add({
                type: 'inquiry', // 퍼블릭 문의 명시
                authorUid: 'public-inquiry', // 익명 처리 (DB 필수 항목 회피)
                userName: userName.trim(),
                userEmail: userEmail.trim(),
                message: message.trim(),
                content: message.trim(), // 호환성을 위해 둘 다 저장
                status: 'unread',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            return { success: true };
        } catch (error) {
            console.error("public feedback error:", error);
            throw new HttpsError("internal", "문의 등록 중 서버 오류가 발생했습니다.");
        }
    }
);
