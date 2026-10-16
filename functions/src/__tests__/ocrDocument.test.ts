/**
 * ocrDocument.test.ts — 비영리 증빙서류 OCR(Gemini)
 * - 지키는 것: Storage 경로는 **호출자 기관·본인 의견 폴더만**(superAdmin은 심사용으로 모든 기관),
 *   경로 조작 거부, 이미지 크기 상한, 분 단위 상한 fail-closed, **입력·경로 검증 뒤에** 일일 한도
 *   (2026-10-16 — 앞에 있어 거부된 요청도 하루 한도를 깎았다), 응답 파싱·사업자번호 보조 판별
 */

const mockGenerateAiContent = jest.fn();
const mockCheckRateLimitByUid = jest.fn().mockResolvedValue(undefined);
const mockCheckDailyOcrQuota = jest.fn().mockResolvedValue(undefined);
const mockDownload = jest.fn().mockResolvedValue([Buffer.from('pdf-bytes')]);
const mockFile = jest.fn((_path: string) => ({ download: mockDownload }));

jest.mock('../core/gemini', () => ({ generateAiContent: (...args: unknown[]) => mockGenerateAiContent(...args) }));
jest.mock('../core/params', () => ({ GEMINI_API_KEY: {} }));
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByUid: (...args: unknown[]) => mockCheckRateLimitByUid(...args),
    checkDailyOcrQuota: (...args: unknown[]) => mockCheckDailyOcrQuota(...args),
}));
jest.mock('../utils/constants', () => ({
    ...jest.requireActual('../utils/constants'),
    getRateLimits: jest.fn(async () => ({ max: 5, windowSec: 60 })),
}));
jest.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: () => ({ file: mockFile }) }) }));
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

import { ocrDocument } from '../handlers/callable/ocrDocument';
import { MAX_BASE64_SIZE } from '../utils/constants';

const handler = ocrDocument as unknown as (req: Record<string, unknown>) => Promise<Record<string, unknown>>;
const admin = { uid: 'a1', token: { orgId: 'org1', role: 'admin' } };
const superAdmin = { uid: 'sa1', token: { role: 'superAdmin' } };
const call = (data: unknown, auth: unknown = admin) => handler({ auth, data });
const exhausted = () => {
    const { HttpsError } = jest.requireMock('firebase-functions/v2/https');
    return new HttpsError('resource-exhausted', '한도 초과');
};

beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimitByUid.mockResolvedValue(undefined);
    mockCheckDailyOcrQuota.mockResolvedValue(undefined);
    mockGenerateAiContent.mockResolvedValue('{"orgName": "행복복지관", "bizNumber": "123-82-45678", "confidence": 0.9}');
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('ocrDocument — 권한·입력', () => {
    it('로그인하지 않으면 거부한다', async () => {
        await expect(call({ imageBase64: 'aGk=' }, null)).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(mockCheckRateLimitByUid).not.toHaveBeenCalled();
    });

    it('분 단위 상한을 fail-closed로 건다 — 걸리면 일일 한도·Gemini 모두 건드리지 않는다', async () => {
        mockCheckRateLimitByUid.mockRejectedValueOnce(exhausted());
        await expect(call({ imageBase64: 'aGk=' })).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(mockCheckRateLimitByUid).toHaveBeenCalledWith('ocrDocument', 'a1', 5, 60, 'closed');
        expect(mockCheckDailyOcrQuota).not.toHaveBeenCalled();
        expect(mockGenerateAiContent).not.toHaveBeenCalled();
    });

    it.each([
        ['경로도 이미지도 없음', {}, 'invalid-argument'],
        ['상위 이동', { storagePath: 'organizations/org1/../org2/doc.png' }, 'invalid-argument'],
        ['역슬래시', { storagePath: 'organizations\\org1\\doc.png' }, 'invalid-argument'],
        ['절대 경로', { storagePath: '/organizations/org1/doc.png' }, 'invalid-argument'],
        ['다른 기관 폴더', { storagePath: 'organizations/org2/doc.png' }, 'permission-denied'],
        ['남의 의견 첨부', { storagePath: 'feedbacks/u9/a.png' }, 'permission-denied'],
        ['기관·의견 폴더 밖', { storagePath: 'users/a1/a.png' }, 'permission-denied'],
        ['이미지 크기 초과', { imageBase64: 'a'.repeat(MAX_BASE64_SIZE + 1) }, 'invalid-argument'],
    ])('%s는 거부하고 일일 한도를 쓰지 않는다', async (_label, data, code) => {
        await expect(call(data)).rejects.toMatchObject({ code });
        expect(mockCheckDailyOcrQuota).not.toHaveBeenCalled();
        expect(mockDownload).not.toHaveBeenCalled();
        expect(mockGenerateAiContent).not.toHaveBeenCalled();
    });

    it.each([
        ['자기 기관 폴더', 'organizations/org1/docs/unique.png'],
        ['본인 의견 첨부', 'feedbacks/a1/shot.png'],
        ['본인 OCR 제보', 'feedbacks/ocr-report/a1/shot.png'],
    ])('%s는 허용한다', async (_label, storagePath) => {
        await expect(call({ storagePath })).resolves.toMatchObject({ orgName: '행복복지관' });
        expect(mockFile).toHaveBeenCalledWith(storagePath);
    });

    it('superAdmin은 심사용으로 어느 기관 폴더든 읽는다(기관 밖은 안 된다)', async () => {
        await expect(call({ storagePath: 'organizations/org9/unique.pdf' }, superAdmin)).resolves.toBeDefined();
        await expect(call({ storagePath: 'users/x/a.png' }, superAdmin)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('일일 한도는 검증을 통과한 뒤 토큰의 uid·기관으로 건다 — 걸리면 내려받지도 않는다', async () => {
        mockCheckDailyOcrQuota.mockRejectedValueOnce(exhausted());
        await expect(call({ storagePath: 'organizations/org1/doc.png' })).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(mockCheckDailyOcrQuota).toHaveBeenCalledWith('a1', 'org1', { max: 5, windowSec: 60 }, { max: 5, windowSec: 60 });
        expect(mockDownload).not.toHaveBeenCalled();
        expect(mockGenerateAiContent).not.toHaveBeenCalled();
    });
});

describe('ocrDocument — 이미지 전달', () => {
    it('Storage 파일은 확장자로 형식을 정해 넘긴다(PDF 포함)', async () => {
        await call({ storagePath: 'organizations/org1/doc.PDF' });
        expect(mockGenerateAiContent.mock.calls[0][1]).toEqual({
            mimeType: 'application/pdf', data: Buffer.from('pdf-bytes').toString('base64'),
        });
    });

    it('모르는 확장자와 형식 없는 base64는 JPEG로 본다', async () => {
        await call({ storagePath: 'organizations/org1/doc.heic' });
        await call({ imageBase64: 'aGk=' });
        expect(mockGenerateAiContent.mock.calls[0][1].mimeType).toBe('image/jpeg');
        expect(mockGenerateAiContent.mock.calls[1][1]).toEqual({ mimeType: 'image/jpeg', data: 'aGk=' });
    });
});

describe('ocrDocument — 응답 파싱', () => {
    it('추출 값을 그대로 돌려주고 빈 값은 null로', async () => {
        const text = '{"orgName": "행복복지관", "bizNumber": "123-82-45678", "repName": "", "address": "서울", "phone": null, "isNonProfit": false, "orgType": "사회복지법인", "confidence": 0.8}';
        mockGenerateAiContent.mockResolvedValueOnce(text);
        await expect(call({ imageBase64: 'aGk=' })).resolves.toEqual({
            orgName: '행복복지관', bizNumber: '123-82-45678', repName: null, address: '서울', phone: null,
            isNonProfit: false, orgType: '사회복지법인', confidence: 0.8, raw: text,
        });
    });

    it.each([
        ['업태 코드 82(비영리)', '123-82-45678', true],
        ['업태 코드 01(개인 과세)', '123-01-45678', false],
        ['숫자가 너무 짧음', '12-3', null],
    ])('비영리 여부가 없으면 사업자번호로 보조 판별한다 — %s', async (_label, bizNumber, expected) => {
        mockGenerateAiContent.mockResolvedValueOnce(JSON.stringify({ bizNumber }));
        const result = await call({ imageBase64: 'aGk=' });
        expect(result.isNonProfit).toBe(expected);
    });

    it('JSON이 깨졌거나 없으면 모두 null·확신도 0', async () => {
        for (const text of ['{"orgName": "x",,}', '읽을 수 없습니다']) {
            mockGenerateAiContent.mockResolvedValueOnce(text);
            await expect(call({ imageBase64: 'aGk=' })).resolves.toMatchObject({
                orgName: null, bizNumber: null, isNonProfit: null, confidence: 0, raw: text,
            });
        }
    });
});
