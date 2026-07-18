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

    // ── 증빙서류 토큰 미노출 회귀 가드 (2026-07-18 보안 재검증 P0-3) ──
    // 증빙서류(민감정보)에 만료 없는 다운로드 토큰을 심거나 그 URL을 저장/반환하면
    // Storage 규칙을 우회하는 무인증 접근이 가능해진다. 아래 셋은 그 재발을 막는다.
    it('영구 다운로드 토큰(firebaseStorageDownloadTokens)을 파일에 심지 않는다', async () => {
        await capturedHandler(makeRequest());
        const saveOptions = mockFileSave.mock.calls[0][1];
        // 중첩 metadata.metadata(사용자 정의 메타)가 없어야 한다 — 토큰은 여기에 심겼었다.
        expect(saveOptions.metadata).not.toHaveProperty('metadata');
        expect(JSON.stringify(saveOptions)).not.toContain('firebaseStorageDownloadTokens');
    });

    it('Firestore에 토큰 URL이 아닌 Storage 경로(uniqueNumberImagePath)를 저장한다', async () => {
        await capturedHandler(makeRequest());
        const savedDoc = mockOrgSet.mock.calls[0][0];
        expect(savedDoc.uniqueNumberImagePath).toBe('organizations/org-test-1/uniqueNumberImage.jpg');
        expect(savedDoc).not.toHaveProperty('uniqueNumberImageUrl');
    });

    it('응답에 다운로드 URL을 포함하지 않는다', async () => {
        const res = await capturedHandler(makeRequest());
        expect(res).not.toHaveProperty('uniqueNumberImageUrl');
        expect(res).toMatchObject({ success: true, orgId: 'org-test-1' });
    });
});
