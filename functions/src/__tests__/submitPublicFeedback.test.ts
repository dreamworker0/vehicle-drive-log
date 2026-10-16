/**
 * submitPublicFeedback.test.ts
 * - 랜딩의 비회원 문의 접수(App Check 없이 열린 경로)
 * - 지키는 것: 입력 검증·길이 상한, 이메일·IP·전역 세 겹 상한(fail-closed), 비회원 표기로 저장,
 *   IP는 resolveClientIp로(X-Forwarded-For 맨 앞 값을 믿지 않는다)
 */

const mockAdd = jest.fn().mockResolvedValue({ id: 'fb1' });
const mockCheckRateLimitByUid = jest.fn().mockResolvedValue(undefined);
const mockCheckRateLimitByIp = jest.fn().mockResolvedValue(false);
const mockCheckGlobalBudget = jest.fn().mockResolvedValue(false);
const mockResolveClientIp = jest.fn(() => '203.0.113.7');

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ collection: jest.fn(() => ({ add: mockAdd })) }),
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}));
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByUid: (...args: unknown[]) => mockCheckRateLimitByUid(...args),
    checkRateLimitByIp: (...args: unknown[]) => mockCheckRateLimitByIp(...args),
    checkGlobalBudget: (...args: unknown[]) => mockCheckGlobalBudget(...args),
}));
jest.mock('../utils/clientIp', () => ({ resolveClientIp: (req: unknown) => mockResolveClientIp(req) }));
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

import { submitPublicFeedback } from '../handlers/https/submitPublicFeedback';

const handler = submitPublicFeedback as unknown as (req: Record<string, unknown>) => Promise<unknown>;
const rawRequest = { headers: { 'x-forwarded-for': '1.2.3.4' } };
const call = (data: Record<string, unknown>) => handler({ auth: null, data, rawRequest });
const valid = { userName: ' 홍길동 ', userEmail: ' Hong@Example.COM ', message: ' 가입 문의드립니다. ' };

describe('submitPublicFeedback', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCheckRateLimitByUid.mockResolvedValue(undefined);
        mockCheckRateLimitByIp.mockResolvedValue(false);
        mockCheckGlobalBudget.mockResolvedValue(false);
    });

    describe('입력 검증', () => {
        it.each([
            ['이름 없음', { ...valid, userName: '' }],
            ['이름 공백', { ...valid, userName: '   ' }],
            ['이름이 문자열 아님', { ...valid, userName: 123 }],
            ['이메일 형식 아님', { ...valid, userEmail: 'not-an-email' }],
            ['이메일 없음', { ...valid, userEmail: undefined }],
            ['내용 없음', { ...valid, message: '  ' }],
            ['이름 100자 초과', { ...valid, userName: 'a'.repeat(101) }],
            ['내용 5000자 초과', { ...valid, message: 'a'.repeat(5001) }],
        ])('%s은 상한 검사 전에 거부한다', async (_label, data) => {
            await expect(call(data)).rejects.toMatchObject({ code: 'invalid-argument' });
            expect(mockCheckRateLimitByUid).not.toHaveBeenCalled();
            expect(mockAdd).not.toHaveBeenCalled();
        });
    });

    describe('상한 — 이메일·IP·전역', () => {
        it('이메일은 소문자로 맞춰 시간당 5회, IP는 resolveClientIp 값으로 30회, 모두 fail-closed', async () => {
            await call(valid);

            expect(mockCheckRateLimitByUid).toHaveBeenCalledWith('submitPublicFeedback', 'hong@example.com', 5, 3600, 'closed');
            expect(mockResolveClientIp).toHaveBeenCalledWith(rawRequest);
            expect(mockCheckRateLimitByIp).toHaveBeenCalledWith('submitPublicFeedback', '203.0.113.7', 30, 3600, 'closed');
            expect(mockCheckGlobalBudget).toHaveBeenCalledWith('submitPublicFeedback', 60, 3600);
        });

        it('이메일 상한에 걸리면 그 오류를 그대로 전하고 저장하지 않는다', async () => {
            const err = Object.assign(new Error('too many'), { code: 'resource-exhausted' });
            mockCheckRateLimitByUid.mockRejectedValueOnce(err);
            await expect(call(valid)).rejects.toBe(err);
            expect(mockAdd).not.toHaveBeenCalled();
        });

        it('IP 상한에 걸리면 저장하지 않는다', async () => {
            mockCheckRateLimitByIp.mockResolvedValueOnce(true);
            await expect(call(valid)).rejects.toMatchObject({ code: 'resource-exhausted' });
            expect(mockCheckGlobalBudget).not.toHaveBeenCalled();
            expect(mockAdd).not.toHaveBeenCalled();
        });

        it('전역 예산이 바닥나면 저장하지 않는다', async () => {
            mockCheckGlobalBudget.mockResolvedValueOnce(true);
            await expect(call(valid)).rejects.toMatchObject({ code: 'resource-exhausted' });
            expect(mockAdd).not.toHaveBeenCalled();
        });
    });

    describe('저장', () => {
        it('다듬은 값을 비회원 문의로 저장한다', async () => {
            await expect(call(valid)).resolves.toEqual({ success: true });
            expect(mockAdd).toHaveBeenCalledWith({
                type: 'inquiry',
                authorUid: 'public-inquiry',
                userName: '홍길동',
                userEmail: 'hong@example.com',
                message: '가입 문의드립니다.',
                content: '가입 문의드립니다.',
                status: 'unread',
                createdAt: 'SERVER_TIMESTAMP',
            });
        });

        it('저장 실패는 내부 오류로 감싸고 원인은 노출하지 않는다', async () => {
            jest.spyOn(console, 'error').mockImplementation(() => {});
            mockAdd.mockRejectedValueOnce(new Error('PERMISSION_DENIED: secret detail'));
            await expect(call(valid)).rejects.toMatchObject({ code: 'internal', message: expect.not.stringContaining('secret') });
        });
    });
});
