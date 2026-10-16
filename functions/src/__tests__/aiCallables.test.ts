/**
 * aiCallables.test.ts — Gemini를 부르는 콜러블(askAI·ocrDashboard)
 * - 지키는 것(ocr-cost-security): 로그인 필수, **분 단위 상한을 fail-closed로**, OCR은 사용자·기관
 *   일일 한도까지 — 상한에 걸리면 Gemini를 부르지 않는다. 입력 크기 상한, 응답 파싱의 안전한 기본값
 * - wrapCallableHandler는 실제 코드. 카운터(checkRateLimitByUid)와 일일 한도(checkDailyOcrQuota)는 목 —
 *   일일 한도 함수 자체의 규칙(사용자 → 기관, fail-closed, 문구)은 rateLimit.test가 원본으로 검사한다
 */

const mockGenerateAiContent = jest.fn();
const mockCheckRateLimitByUid = jest.fn().mockResolvedValue(undefined);
const mockCheckDailyOcrQuota = jest.fn().mockResolvedValue(undefined);

jest.mock('../core/gemini', () => ({
    generateAiContent: (...args: unknown[]) => mockGenerateAiContent(...args),
}));
jest.mock('../core/params', () => ({ GEMINI_API_KEY: {} }));
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByUid: (...args: unknown[]) => mockCheckRateLimitByUid(...args),
    checkDailyOcrQuota: (...args: unknown[]) => mockCheckDailyOcrQuota(...args),
}));
jest.mock('../utils/constants', () => ({
    ...jest.requireActual('../utils/constants'),
    getRateLimits: jest.fn(async (key: string) => ({ max: key.startsWith('ocrDaily') ? 20 : 5, windowSec: key.startsWith('ocrDaily') ? 86400 : 60 })),
}));
jest.mock('../utils/faqData', () => ({ buildFaqPromptText: () => '[FAQ] 앱 설치 방법…' }));
jest.mock('../core/sentry', () => ({ captureError: jest.fn(), flushSentry: jest.fn().mockResolvedValue(undefined) }));
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }));
jest.mock('firebase-admin/firestore', () => ({ getFirestore: jest.fn(), FieldValue: {} }));
jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_opts: unknown, handler: (req: unknown) => unknown) => handler,
    HttpsError: class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
}));

import { askAI } from '../handlers/callable/askAI';
import { ocrDashboard } from '../handlers/callable/ocrDashboard';
import { MAX_BASE64_SIZE } from '../utils/constants';

type Handler = (req: Record<string, unknown>) => Promise<Record<string, unknown>>;
const ask = askAI as unknown as Handler;
const ocr = ocrDashboard as unknown as Handler;
const employee = { uid: 'u1', token: { orgId: 'org1', role: 'employee' } };
const exhausted = () => {
    const { HttpsError } = jest.requireMock('firebase-functions/v2/https');
    return new HttpsError('resource-exhausted', '요청이 너무 많습니다.');
};

beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimitByUid.mockResolvedValue(undefined);
    mockCheckDailyOcrQuota.mockResolvedValue(undefined);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('askAI', () => {
    it('로그인하지 않으면 Gemini를 부르지 않는다', async () => {
        await expect(ask({ auth: null, data: { question: '설치?' } })).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(mockGenerateAiContent).not.toHaveBeenCalled();
    });

    it('분 단위 상한을 fail-closed로 건다 — 걸리면 Gemini를 부르지 않는다', async () => {
        mockCheckRateLimitByUid.mockRejectedValueOnce(exhausted());
        await expect(ask({ auth: employee, data: { question: '설치?' } })).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(mockCheckRateLimitByUid).toHaveBeenCalledWith('askAI', 'u1', 5, 60, 'closed');
        expect(mockGenerateAiContent).not.toHaveBeenCalled();
    });

    it.each([['빈 질문', '   '], ['질문 없음', undefined], ['500자 초과', '가'.repeat(501)]])('%s은 거부한다', async (_label, question) => {
        await expect(ask({ auth: employee, data: { question } })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockGenerateAiContent).not.toHaveBeenCalled();
    });

    it('FAQ·설명서와 다듬은 질문으로 짧게 답하게 한다', async () => {
        mockGenerateAiContent.mockResolvedValueOnce('홈 화면에 추가하세요.\nFAQ[app-install]');
        await expect(ask({ auth: employee, data: { question: '  앱 설치는?  ' } })).resolves.toEqual({ answer: '홈 화면에 추가하세요.\nFAQ[app-install]' });

        const [prompt, images, model, options] = mockGenerateAiContent.mock.calls[0];
        expect(prompt).toContain('[FAQ] 앱 설치 방법');
        expect(prompt).toContain('[사용 설명서 요약 — 관리자 기능]');
        expect(prompt).toContain('"앱 설치는?"');
        expect(images).toBeUndefined();
        expect(model).toBe('gemini-3.1-flash-lite');
        expect(options).toEqual({ maxOutputTokens: 500, temperature: 0.3 });
    });

    it('빈 응답이면 건의하기 안내로 대신한다', async () => {
        mockGenerateAiContent.mockResolvedValueOnce('');
        const { answer } = await ask({ auth: employee, data: { question: '?' } });
        expect(answer).toContain('건의하기');
    });

    it('Gemini 오류는 원인 없이 internal로 감싼다', async () => {
        mockGenerateAiContent.mockRejectedValueOnce(new Error('API key invalid: AIza-secret'));
        await expect(ask({ auth: employee, data: { question: '?' } })).rejects.toMatchObject({
            code: 'internal', message: expect.not.stringContaining('secret'),
        });
    });
});

describe('ocrDashboard', () => {
    const image = { imageBase64: 'aGVsbG8=', mimeType: 'image/png' };

    it('로그인하지 않으면 거부한다', async () => {
        await expect(ocr({ auth: null, data: image })).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(mockCheckRateLimitByUid).not.toHaveBeenCalled();
    });

    it('분 단위 상한(fail-closed) 뒤 토큰의 uid·기관으로 일일 한도를 건다', async () => {
        mockGenerateAiContent.mockResolvedValueOnce('{"km": 12345}');
        await ocr({ auth: employee, data: image });

        expect(mockCheckRateLimitByUid).toHaveBeenCalledWith('ocrDashboard', 'u1', 5, 60, 'closed');
        expect(mockCheckDailyOcrQuota).toHaveBeenCalledWith('u1', 'org1', { max: 20, windowSec: 86400 }, { max: 20, windowSec: 86400 });
        expect(mockCheckRateLimitByUid.mock.invocationCallOrder[0]).toBeLessThan(mockCheckDailyOcrQuota.mock.invocationCallOrder[0]);
    });

    it('분 단위 상한에 걸리면 일일 한도도 쓰지 않는다', async () => {
        mockCheckRateLimitByUid.mockRejectedValueOnce(exhausted());
        await expect(ocr({ auth: employee, data: image })).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(mockCheckDailyOcrQuota).not.toHaveBeenCalled();
        expect(mockGenerateAiContent).not.toHaveBeenCalled();
    });

    it('일일 한도에 걸리면 Gemini를 부르지 않는다', async () => {
        mockCheckDailyOcrQuota.mockRejectedValueOnce(exhausted());
        await expect(ocr({ auth: employee, data: image })).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(mockGenerateAiContent).not.toHaveBeenCalled();
    });

    it('기관이 없는 토큰은 기관 자리에 undefined를 넘긴다(사용자 한도만)', async () => {
        mockGenerateAiContent.mockResolvedValueOnce('{"km": 1}');
        await ocr({ auth: { uid: 'u1', token: {} }, data: image });
        expect(mockCheckDailyOcrQuota.mock.calls[0][1]).toBeUndefined();
    });

    it('이미지가 없거나 크기 상한을 넘으면 거부한다', async () => {
        await expect(ocr({ auth: employee, data: {} })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(ocr({ auth: employee, data: { imageBase64: 'a'.repeat(MAX_BASE64_SIZE + 1) } }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockGenerateAiContent).not.toHaveBeenCalled();
        // 2026-10-16 — 검증 전에 일일 한도를 세서 잘못된 요청도 하루 OCR 한 번을 깎았다
        expect(mockCheckDailyOcrQuota).not.toHaveBeenCalled();
    });

    it('일반 차량은 km만, 전기차는 km와 배터리를 묻는다', async () => {
        mockGenerateAiContent.mockResolvedValue('{"km": 1}');
        await ocr({ auth: employee, data: image });
        await ocr({ auth: employee, data: { ...image, isElectric: true } });

        expect(mockGenerateAiContent.mock.calls[0][0]).toContain('{"km": 숫자}');
        expect(mockGenerateAiContent.mock.calls[0][0]).not.toContain('배터리 잔량');
        expect(mockGenerateAiContent.mock.calls[1][0]).toContain('{"km": 숫자, "battery": 숫자}');
    });

    it('이미지를 그대로 넘기고, 형식이 없으면 JPEG로 본다', async () => {
        mockGenerateAiContent.mockResolvedValue('{"km": 1}');
        await ocr({ auth: employee, data: image });
        await ocr({ auth: employee, data: { imageBase64: 'aGVsbG8=' } });
        expect(mockGenerateAiContent.mock.calls[0][1]).toEqual({ mimeType: 'image/png', data: 'aGVsbG8=' });
        expect(mockGenerateAiContent.mock.calls[1][1]).toEqual({ mimeType: 'image/jpeg', data: 'aGVsbG8=' });
    });

    describe('응답 파싱', () => {
        it.each([
            ['JSON', '{"km": 12345, "battery": 80}', 12345, 80],
            ['앞뒤 설명이 붙은 JSON', '판독 결과입니다:\n```json\n{"km": 54321}\n```', 54321, null],
            ['판독 불가(null)', '{"km": null, "battery": null}', null, null],
            ['JSON이 아예 없음', '숫자를 읽을 수 없습니다', null, null],
        ])('%s', async (_label, text, km, battery) => {
            mockGenerateAiContent.mockResolvedValueOnce(text);
            await expect(ocr({ auth: employee, data: { ...image, isElectric: true } })).resolves.toEqual({ km, battery, raw: text });
        });

        it('깨진 JSON이면 숫자만 뽑는다(전기차는 두 번째 숫자를 배터리로)', async () => {
            mockGenerateAiContent.mockResolvedValueOnce('{"km": 23456, "battery": 77,,}');
            await expect(ocr({ auth: employee, data: { ...image, isElectric: true } }))
                .resolves.toMatchObject({ km: 23456, battery: 77 });

            mockGenerateAiContent.mockResolvedValueOnce('{"km": 23456,,}');
            await expect(ocr({ auth: employee, data: image })).resolves.toMatchObject({ km: 23456, battery: null });
        });

        // 2026-10-16 — 문자열 값에 Number()를 그대로 써서 NaN이 나갔고, 화면은 km != null만 보고
        // 도착 km 칸에 "NaN"을 채웠다
        it.each([
            ['콤마가 든 문자열', '{"km": "12,345", "battery": "80"}', 12345, 80],
            ['소수점·단위가 붙은 문자열', '{"km": "12,345.6 km", "battery": "80%"}', 12345, 80],
            ['소수점 숫자', '{"km": 12345.9, "battery": 79.5}', 12345, 79],
            ['숫자가 없는 문자열', '{"km": "읽을 수 없음", "battery": "?"}', null, null],
            ['음수', '{"km": -5, "battery": -1}', null, null],
            ['범위 밖(배터리 100 초과·오도미터 7자리 초과)', '{"km": 123456789, "battery": 150}', null, null],
            ['숫자도 문자열도 아님', '{"km": true, "battery": [80]}', null, null],
        ])('%s는 NaN 없이 정수나 null로', async (_label, text, km, battery) => {
            mockGenerateAiContent.mockResolvedValueOnce(text);
            const result = await ocr({ auth: employee, data: { ...image, isElectric: true } });
            expect(result).toMatchObject({ km, battery });
            expect(Number.isNaN(result.km)).toBe(false);
            expect(Number.isNaN(result.battery)).toBe(false);
        });

        it('깨진 JSON에서도 콤마가 든 숫자를 쪼개지 않는다', async () => {
            mockGenerateAiContent.mockResolvedValueOnce('{"km": 12,345, "battery": 80,,}');
            await expect(ocr({ auth: employee, data: { ...image, isElectric: true } }))
                .resolves.toMatchObject({ km: 12345, battery: 80 });
        });
    });
});
