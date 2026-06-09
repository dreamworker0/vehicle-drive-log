/**
 * askAI — AI에게 물어보기 Cloud Function
 *
 * FAQ 데이터 + 사용 설명서를 컨텍스트로 활용하여
 * Gemini flash-lite로 사용자 질문에 답변한다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { buildFaqPromptText } from "../../utils/faqData";
import { generateAiContent } from "../../core/gemini";
import { wrapCallableHandler } from "../../utils/helpers";

/**
 * 사용 설명서 요약 텍스트 (manualSections.ts의 핵심 내용을 축약)
 * Cloud Function에서는 프론트엔드 모듈을 직접 import할 수 없으므로 텍스트로 관리
 */
const MANUAL_SUMMARY = `
[사용 설명서 요약 — 관리자 기능]
- 대시보드: 오늘의 예약, 운행 현황, 차량별 상태를 한눈에 확인
- 직원 관리: 초대 코드로 직원 합류, 통합 목록(활성/대기/비활성), 역할 변경(관리자↔직원)
- 차량 관리: 차량 등록/수정/삭제, 📅 캘린더 연동 뱃지, 차량 퇴역/복귀, 하이패스 카드 등록
- 운행일지: 날짜·차량·직원 필터, PDF/엑셀 다운로드, 하이패스 정보 포함 출력
- 예약: 타임라인 뷰, 다일(연속) 예약, 정비 중 차량 자동 차단
- 통계: 운행 빈도·거리·비용 차트, 하이패스/주유비 비교 차트, PDF 인쇄 가능
- 정비 기록: 유형별 등록, 정비 중 차량 차단, 엑셀/PDF 내보내기
- 주유·충전: 주유 기록, 하이패스 충전 기록 및 통계 차트
- 설정: 이메일/전화번호 수정, 결재 라인 설정, 공휴일 관리, 관리자 공지

[사용 설명서 요약 — 직원 기능]
- 홈: 오늘 예약, 빠른 출발, 원클릭 예약 추천(패턴 분석)
- 운행일지 작성: AI 계기판 OCR, 하이패스 사용전/사용후, OCR 오류 제보
- 내 기록: 자신의 운행 기록 조회·수정 (7일 이내)
- 예약: 차량 예약, 다일 예약, 무통행료 경로 비교
- 즐겨찾기: 목적지 즐겨찾기 등록, 예약 시 빠른 선택
- 주유·충전: 주유소 기록, 하이패스 충전 기록
- 차량 이용 내역: 본인이 운행한 차량별 이력
- 차량 보험 정보: 보험사·연락처 확인, 사고 시 빠른 전화
- 설정: 다크 모드, 글자 크기, 길안내 앱 선택, 알림
- 앱 설치: 홈 화면에 아이콘 추가 (PWA)
`;

export const askAI = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 30,
        memory: "256MiB",
        enforceAppCheck: false,
        cors: true,
    },
    wrapCallableHandler("askAI", { rateLimitKey: "askAI" }, async (request) => {
        const question = (request.data as { question?: string })?.question?.trim();

        if (!question) {
            throw new HttpsError("invalid-argument", "질문을 입력해주세요.");
        }

        if (question.length > 500) {
            throw new HttpsError("invalid-argument", "질문은 500자 이내로 입력해주세요.");
        }

        const faqText = buildFaqPromptText();

        const prompt = `당신은 '차량 운행일지' 앱의 AI 도우미입니다.
사용자의 질문에 친절하고 정확하게 답변해주세요.

[중요 규칙]
1. 아래 FAQ 데이터와 사용 설명서를 기반으로만 답변하세요.
2. 모르는 내용이면 "죄송합니다, 정확한 답변이 어렵습니다. '건의하기'를 통해 개발자에게 직접 문의해주세요."라고 안내하세요.
3. 답변은 2~4문장으로 간결하게 작성하세요.
4. 존댓말을 사용하세요.
5. 기술 전문 용어(PWA, API 등)는 쉬운 말로 바꿔주세요.
6. 답변의 맨 마지막에는 **반드시** 아래 형식 그대로 안내 문구를 추가하세요. FAQ 토큰을 문장 안에 섞지 마세요.
   - 관련 FAQ가 있을 때 (정확히 이 형식을 따르세요):
     자세한 내용은 아래 링크를 참고하세요.
     FAQ[faq_id]
   - 관련 FAQ가 여러 개일 때도 한 줄씩 나열하세요:
     자세한 내용은 아래 링크를 참고하세요.
     FAQ[faq_id_1]
     FAQ[faq_id_2]
   - 관련 FAQ가 없다면: "자세한 내용은 FAQ를 참고해주세요."
7. 절대 허위 정보를 만들어내지 마세요.

[자주 하는 질문(FAQ)]
${faqText}

${MANUAL_SUMMARY}

[사용자 질문]
"${question}"

답변:`;

        const text = await generateAiContent(
            prompt,
            undefined,
            "gemini-3.1-flash-lite",
            {
                maxOutputTokens: 500,
                temperature: 0.3,
            }
        );

        const answer = text || "죄송합니다, 답변을 생성하지 못했습니다. '건의하기'를 통해 개발자에게 직접 문의해주세요.";

        return { answer };
    })
);

