/**
 * submitOrgApplication.test — 기관 신청 업로드 MIME 화이트리스트 검증
 * (2026-07-10 코덱스 평가 대응 개선계획 작업 3)
 */

// ── onCall / HttpsError 캡처를 위한 Mock ──
let capturedHandler: any;

class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_options: any, handler: any) => {
        capturedHandler = handler;
    },
    HttpsError: MockHttpsError,
}));

// ── Firestore / Storage Mock ──
const mockOrgSet = jest.fn().mockResolvedValue(undefined);
const mockFileSave = jest.fn().mockResolvedValue(undefined);

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: () => ({
            doc: () => ({ id: 'org-test-1', set: mockOrgSet }),
        }),
    }),
    FieldValue: {
        serverTimestamp: jest.fn(() => 'mock-timestamp'),
    },
}));

jest.mock('firebase-admin/storage', () => ({
    getStorage: () => ({
        bucket: () => ({
            name: 'test-bucket',
            file: () => ({ save: mockFileSave }),
        }),
    }),
}));

jest.mock('uuid', () => ({ v4: () => 'test-token' }));

// helpers는 sentry 의존이 있어 로깅·래퍼만 통과시키는 mock으로 대체
jest.mock('../utils/helpers', () => ({
    log: jest.fn(),
    wrapHandler: (_name: string, handler: any) => handler,
}));

// rate limit은 이 테스트의 관심사가 아니므로 항상 통과
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByUid: jest.fn().mockResolvedValue(undefined),
    checkRateLimitByIp: jest.fn().mockResolvedValue(false),
}));

// 모듈 로드 (capturedHandler 설정)
require('../handlers/https/submitOrgApplication');

describe('submitOrgApplication — MIME 화이트리스트', () => {
    const validPayload = {
        orgName: '테스트복지관',
        applicantName: '홍길동',
        applicantEmail: 'test@example.com',
        applicantPhone: '010-1234-5678',
        message: '신청합니다',
        imageBase64: Buffer.from('dummy-image').toString('base64'),
        imageMimeType: 'image/jpeg',
    };

    const makeRequest = (overrides: Record<string, unknown> = {}) => ({
        auth: null,
        rawRequest: { ip: '1.2.3.4', headers: {} },
        data: { ...validPayload, ...overrides },
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it.each(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])(
        '허용 MIME(%s) → 통과하고 업로드가 수행된다',
        async (mime) => {
            await expect(
                capturedHandler(makeRequest({ imageMimeType: mime }))
            ).resolves.toMatchObject({ success: true });
            expect(mockFileSave).toHaveBeenCalledTimes(1);
        }
    );

    it.each(['text/html', 'application/octet-stream', 'image/svg+xml'])(
        '비허용 MIME(%s) → invalid-argument 거부, 업로드·저장 미수행',
        async (mime) => {
            await expect(
                capturedHandler(makeRequest({ imageMimeType: mime }))
            ).rejects.toMatchObject({ code: 'invalid-argument' });
            expect(mockFileSave).not.toHaveBeenCalled();
            expect(mockOrgSet).not.toHaveBeenCalled();
        }
    );

    it('빈 MIME 문자열 → invalid-argument 거부 (필수값 검증)', async () => {
        await expect(
            capturedHandler(makeRequest({ imageMimeType: '' }))
        ).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockFileSave).not.toHaveBeenCalled();
    });

    it('허용 MIME이 파일 확장자·contentType에 그대로 반영된다 (PDF)', async () => {
        await capturedHandler(makeRequest({ imageMimeType: 'application/pdf' }));
        expect(mockFileSave).toHaveBeenCalledWith(
            expect.any(Buffer),
            expect.objectContaining({
                metadata: expect.objectContaining({ contentType: 'application/pdf' }),
            })
        );
    });
});
