/**
 * generateFeedbackDraft.test.ts
 * - parseAiResponse(): JSON 파싱 및 기본값 처리 로직 테스트
 * - prefix 강제 삽입 로직 테스트
 * - Gemini API, Firestore 등 외부 의존성은 mock 처리
 */

// ── 외부 의존성 Mock ──
jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn() }));
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: jest.fn(() => ({
        collection: jest.fn(() => ({
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
        })),
    })),
}));
jest.mock('../utils/faqData', () => ({ buildFaqPromptText: jest.fn(() => '가짜 FAQ 텍스트') }));
jest.mock('../core/discord', () => ({ sendDiscordAlert: jest.fn().mockResolvedValue(undefined) }));
jest.mock('firebase-functions/params', () => ({
    defineString: jest.fn(() => ({ value: jest.fn(() => 'mock-key') })),
}));
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: jest.fn(),
}));

// ── parseAiResponse 순수 함수 재현 ──
function parseAiResponse(text: string): {
    faqId: string | null;
    confidence: number;
    draft: string;
} {
    const defaults = { faqId: null, confidence: 0, draft: '' };
    try {
        const jsonMatch = text.match(/\{[\s\S]*?\}/);
        if (!jsonMatch) return defaults;
        const parsed = JSON.parse(jsonMatch[0]);
        return {
            faqId: parsed.faqId ?? parsed.faqIndex ?? null,
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
            draft: parsed.draft || '',
        };
    } catch {
        return defaults;
    }
}

const PREFIX = '안녕하세요. 김종원입니다. 초안은 인공지능이 작성합니다.';

/** prefix가 없으면 앞에 붙이는 로직 */
function applyPrefix(draft: string): string {
    const trimmed = draft.trim();
    if (!trimmed.startsWith(PREFIX)) {
        return `${PREFIX}\n\n${trimmed}`;
    }
    return trimmed;
}

// ──────────────────────────────────────────────────
describe('parseAiResponse()', () => {
    it('올바른 JSON → 정상 파싱', () => {
        const text = '{"faqId": "app-install", "confidence": 0.85, "draft": "답변 내용"}';
        const result = parseAiResponse(text);
        expect(result.faqId).toBe('app-install');
        expect(result.confidence).toBe(0.85);
        expect(result.draft).toBe('답변 내용');
    });

    it('JSON이 없으면 기본값 반환', () => {
        const result = parseAiResponse('이것은 JSON이 아닙니다.');
        expect(result).toEqual({ faqId: null, confidence: 0, draft: '' });
    });

    it('빈 문자열 → 기본값 반환', () => {
        const result = parseAiResponse('');
        expect(result).toEqual({ faqId: null, confidence: 0, draft: '' });
    });

    it('faqId가 null인 경우 처리', () => {
        const text = '{"faqId": null, "confidence": 0.2, "draft": "매칭 없는 답변"}';
        const result = parseAiResponse(text);
        expect(result.faqId).toBeNull();
        expect(result.confidence).toBe(0.2);
    });

    it('구 포맷 faqIndex → faqId로 하위 호환 처리', () => {
        const text = '{"faqIndex": "old-format", "confidence": 0.5, "draft": "구버전"}';
        const result = parseAiResponse(text);
        expect(result.faqId).toBe('old-format');
    });

    it('confidence가 숫자가 아닐 경우 → 0으로 처리', () => {
        const text = '{"faqId": "x", "confidence": "높음", "draft": "내용"}';
        const result = parseAiResponse(text);
        expect(result.confidence).toBe(0);
    });

    it('깨진 JSON → 기본값 반환', () => {
        const result = parseAiResponse('{broken json:');
        expect(result).toEqual({ faqId: null, confidence: 0, draft: '' });
    });

    it('JSON 앞뒤에 텍스트가 있어도 파싱 가능', () => {
        const text = '모델 응답입니다: {"faqId": "x", "confidence": 0.9, "draft": "답변"} 끝';
        const result = parseAiResponse(text);
        expect(result.faqId).toBe('x');
    });
});

describe('applyPrefix() — prefix 강제 삽입 로직', () => {
    it('prefix가 없으면 앞에 붙인다', () => {
        const result = applyPrefix('소중한 의견 감사합니다.');
        expect(result).toContain(PREFIX);
        expect(result.startsWith(PREFIX)).toBe(true);
    });

    it('이미 prefix가 있으면 중복 삽입하지 않는다', () => {
        const draft = `${PREFIX}\n\n이미 있는 내용`;
        const result = applyPrefix(draft);
        const count = result.split(PREFIX).length - 1;
        expect(count).toBe(1);
    });

    it('빈 draft에도 prefix 삽입', () => {
        const result = applyPrefix('');
        expect(result).toContain(PREFIX);
    });

    it('앞뒤 공백 있는 draft는 trim 후 prefix 삽입', () => {
        const result = applyPrefix('   내용   ');
        expect(result.startsWith(PREFIX)).toBe(true);
        expect(result).toContain('내용');
    });
});
