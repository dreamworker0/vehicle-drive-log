import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { defineString } from "firebase-functions/params";
import { GoogleGenAI } from "@google/genai";
import { buildFaqPromptText } from "./faqData";

const geminiApiKey = defineString("GEMINI_API_KEY");
const db = getFirestore();

/** 최근 답변 완료된 피드백을 조회하여 few-shot example 텍스트 생성 */
async function buildPastExamplesText(limit = 5): Promise<string> {
    const snap = await db
        .collection("feedbacks")
        .where("status", "==", "resolved")
        .orderBy("repliedAt", "desc")
        .limit(limit)
        .get();

    if (snap.empty) return "";

    const examples = snap.docs.map((doc) => {
        const d = doc.data();
        const question = d.message || d.content || "";
        const finalReply = d.reply || "";
        return `---\n의견: "${question}"\n최종 답변: "${finalReply}"`;
    });

    return `\n[과거 답변 사례 — 이 스타일과 톤을 참고하세요]\n${examples.join("\n")}\n`;
}

/** Gemini 응답 JSON 파싱 */
function parseAiResponse(text: string): {
    faqId: string | null;
    confidence: number;
    draft: string;
} {
    const defaults = { faqId: null, confidence: 0, draft: "" };

    try {
        const jsonMatch = text.match(/\{[\s\S]*?\}/);
        if (!jsonMatch) return defaults;

        const parsed = JSON.parse(jsonMatch[0]);
        return {
            faqId: parsed.faqId ?? parsed.faqIndex ?? null,
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
            draft: parsed.draft || "",
        };
    } catch {
        console.error("[regenerateFeedbackDraft] JSON 파싱 실패:", text);
        return defaults;
    }
}

export const regenerateFeedbackDraft = onCall(
    { region: "asia-northeast3", timeoutSeconds: 60, enforceAppCheck: false },
    async (request) => {
        // 인증 확인
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "인증이 필요합니다.");
        }
        // superAdmin 권한 확인 (관리자만 다시 생성 가능)
        if (request.auth.token.role !== "superAdmin") {
            throw new HttpsError("permission-denied", "시스템 관리자만 권한이 있습니다.");
        }

        const { feedbackId } = request.data;
        if (!feedbackId) {
            throw new HttpsError("invalid-argument", "피드백 ID가 필요합니다.");
        }

        const docRef = db.collection("feedbacks").doc(feedbackId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            throw new HttpsError("not-found", "피드백을 찾을 수 없습니다.");
        }

        const data = docSnap.data()!;
        const message = data.message || data.content || "";

        if (!message.trim()) {
            throw new HttpsError("invalid-argument", "피드백 본문이 비어있어 분석할 수 없습니다.");
        }

        try {
            console.log(`[regenerateFeedbackDraft] 요청 수신 (feedbackId: ${feedbackId})`);
            
            // 1. FAQ 프롬프트 텍스트 생성
            const faqText = buildFaqPromptText();

            // 2. 과거 답변 사례 조회
            const pastExamples = await buildPastExamplesText(5);

            // 3. Gemini 프롬프트 구성
            const prompt = `당신은 '차량 운행일지' 앱의 고객 지원 담당자입니다.
사용자의 의견에 친절하고 비전문가도 쉽게 이해할 수 있는 일상적인 언어로 답변 초안을 작성해주세요.

[중요 앱 정보]
- PWA(Progressive Web App) 등의 어려운 IT 전문 용어는 절대 사용하지 마세요.
- 앱 다운로드/설치 방법을 묻는 경우: "이 앱은 구글 플레이스토어나 애플 앱스토어어스 다운받는 앱이 아니라, 인터넷 화면에서 직접 추가하는 방식입니다. 안드로이드는 화면 상단 메뉴 모음(점 3개)이나 주소창에서 '홈 화면에 추가' 또는 '앱 설치'를, 아이폰은 하단 공유 버튼(네모 화살표)을 눌러서 '홈 화면에 추가'를 눌러주세요." 라고 쉽게 안내하세요.

[자주 하는 질문(FAQ)]
${faqText}
${pastExamples}
[현재 사용자 의견]
"${message}"

다음 규칙을 따르세요:
1. FAQ와 매칭되면 답변을 기반으로 초안을 작성하고, 매칭된 항목의 고유 ID(faqId)와 확신도(confidence, 0~1)를 응답에 포함하세요.
2. FAQ에 없는 내용이라도 (기능 요청, 버그 신고 등) 반드시 친절한 답변 초안을 작성하세요.
3. 과거 답변 사례를 참고해 사람처럼 자연스럽고 친절하게 작성하세요. (존댓말, 2~4문장)
4. FAQ와 매칭된 경우, 답변 끝에 반드시 해당 FAQ 항목으로 바로 이동할 수 있는 링크를 남겨주세요.
   - 링크 형식: https://vehicle-drive-log.web.app/faq#{해당 faqId}
   - 예시 문구: "자세한 설정 방법은 아래 링크(자주 하는 질문)를 참고해 주세요. \n👉 https://vehicle-drive-log.web.app/faq#app-install"

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만:
{"faqId": "app-install", "confidence": 0.85, "draft": "답변 초안 내용..."}

매칭되는 FAQ가 없다면 faqId를 null로 설정하세요.`;

            // 4. Gemini API 호출
            const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [{ role: "user", parts: [{ text: prompt }] }],
            });

            const text = response.text?.trim() || "";
            const result = parseAiResponse(text);

            // 5. Firestore 업데이트
            await docRef.update({
                aiDraft: result.draft,
                aiMatchedFaqId: result.faqId,
                aiMatchedFaqIndex: null, // 기존 필드는 null 처리
                aiConfidence: result.confidence,
                aiRegeneratedAt: new Date(), // 언제 재생성 했는지 추적용
            });

            console.log(
                `[regenerateFeedbackDraft] 완료 (feedbackId: ${feedbackId}): FAQ ID=${result.faqId}, 확신도=${result.confidence}`
            );

            return { success: true, ...result };
            
        } catch (err: unknown) {
            const error = err as Error;
            console.error("[regenerateFeedbackDraft] 오류:", error.message);
            throw new HttpsError("internal", "답변 초안을 재생성하는 데 실패했습니다.", error.message);
        }
    }
);
