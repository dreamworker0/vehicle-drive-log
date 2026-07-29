/**
 * acceptCurrentTerms.test — 개정 약관 재동의 기록
 *
 * 역할별 기록 대상이 다르다. 관리자는 기관의 위탁 계약 동의까지, 직원은 본인 약관 동의만.
 * 이 분기가 틀리면 직원에게 개인정보 동의를 받거나 기관 위탁 동의가 누락된다.
 */

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

const mockUserGet = jest.fn();
const mockUserSet = jest.fn().mockResolvedValue(undefined);
const mockOrgSet = jest.fn().mockResolvedValue(undefined);

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => ({
            doc: () =>
                name === 'users'
                    ? { get: mockUserGet, set: mockUserSet }
                    : { set: mockOrgSet },
        }),
    }),
    FieldValue: {
        serverTimestamp: jest.fn(() => 'mock-timestamp'),
    },
}));

jest.mock('../utils/helpers', () => ({
    log: jest.fn(),
    wrapHandler: (_name: string, handler: any) => handler,
}));

jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByUid: jest.fn().mockResolvedValue(undefined),
}));

require('../handlers/callable/acceptCurrentTerms');

describe('acceptCurrentTerms — 재동의 기록', () => {
    const makeRequest = (data: Record<string, unknown> = {}, auth: any = { uid: 'user-001' }) => ({
        auth,
        data: { agreedTerms: true, termsVersion: '2026-08-05', ...data },
    });

    /** 사용자 문서 상태를 지정한다 */
    const setUserDoc = (data: Record<string, unknown> | null) => {
        mockUserGet.mockResolvedValue(
            data === null ? { exists: false, data: () => undefined } : { exists: true, data: () => data }
        );
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockUserSet.mockResolvedValue(undefined);
        mockOrgSet.mockResolvedValue(undefined);
        setUserDoc({ role: 'employee', organizationId: 'org-1' });
    });

    it('직원: 본인 약관 동의만 기록하고 기관 문서는 건드리지 않는다', async () => {
        const result = await capturedHandler(makeRequest());

        expect(result).toEqual({ success: true, orgRecorded: false });
        expect(mockOrgSet).not.toHaveBeenCalled();
        expect(mockUserSet).toHaveBeenCalledWith(
            {
                consent: { terms: true, termsVersion: '2026-08-05', agreedAt: 'mock-timestamp' },
            },
            { merge: true }
        );
    });

    it('직원: 개인정보 동의를 보내와도 기록하지 않는다', async () => {
        // 직원 개인정보의 처리 근거는 동의가 아니므로 privacy를 남기면 안 된다.
        await capturedHandler(makeRequest({ agreedPrivacy: true, privacyVersion: '2026-08-05' }));

        const saved = mockUserSet.mock.calls[0][0];
        expect(saved.consent).not.toHaveProperty('privacy');
        expect(saved.consent).not.toHaveProperty('privacyVersion');
        expect(mockOrgSet).not.toHaveBeenCalled();
    });

    it('관리자: 기관 위탁 동의와 본인 약관 동의를 함께 기록한다', async () => {
        setUserDoc({ role: 'admin', organizationId: 'org-1' });

        const result = await capturedHandler(
            makeRequest({ agreedPrivacy: true, privacyVersion: '2026-08-05' })
        );

        expect(result).toEqual({ success: true, orgRecorded: true });
        expect(mockOrgSet).toHaveBeenCalledWith(
            {
                consent: {
                    terms: true,
                    privacy: true,
                    termsVersion: '2026-08-05',
                    privacyVersion: '2026-08-05',
                    agreedAt: 'mock-timestamp',
                    source: 'reconsent',
                    agreedByUid: 'user-001',
                },
            },
            { merge: true }
        );
        expect(mockUserSet).toHaveBeenCalledTimes(1);
    });

    it('관리자: 처리방침 동의가 없으면 거부하고 아무것도 기록하지 않는다', async () => {
        setUserDoc({ role: 'admin', organizationId: 'org-1' });

        await expect(capturedHandler(makeRequest())).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockUserSet).not.toHaveBeenCalled();
        expect(mockOrgSet).not.toHaveBeenCalled();
    });

    it('관리자: 처리방침 버전 형식이 틀리면 거부한다', async () => {
        setUserDoc({ role: 'admin', organizationId: 'org-1' });

        await expect(
            capturedHandler(makeRequest({ agreedPrivacy: true, privacyVersion: 'latest' }))
        ).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockOrgSet).not.toHaveBeenCalled();
    });

    it('기관이 없는 관리자(비정상 상태)는 기관 문서를 기록하지 않는다', async () => {
        setUserDoc({ role: 'admin', organizationId: null });

        const result = await capturedHandler(makeRequest());

        expect(result).toEqual({ success: true, orgRecorded: false });
        expect(mockOrgSet).not.toHaveBeenCalled();
    });

    it('superAdmin은 본인 약관 동의만 기록한다', async () => {
        setUserDoc({ role: 'superAdmin', organizationId: null });

        const result = await capturedHandler(makeRequest());

        expect(result).toEqual({ success: true, orgRecorded: false });
        expect(mockOrgSet).not.toHaveBeenCalled();
    });

    it('미인증 요청 → unauthenticated', async () => {
        await expect(capturedHandler(makeRequest({}, null))).rejects.toMatchObject({
            code: 'unauthenticated',
        });
        expect(mockUserSet).not.toHaveBeenCalled();
    });

    it('사용자 문서가 없으면 failed-precondition', async () => {
        setUserDoc(null);

        await expect(capturedHandler(makeRequest())).rejects.toMatchObject({
            code: 'failed-precondition',
        });
        expect(mockUserSet).not.toHaveBeenCalled();
    });

    it.each([
        ['agreedTerms 누락', { agreedTerms: undefined }],
        ['agreedTerms=false', { agreedTerms: false }],
        ['boolean이 아닌 truthy 값', { agreedTerms: 'yes' }],
        ['termsVersion 형식 불일치', { termsVersion: '2026-8-5' }],
        ['termsVersion 타입 불일치', { termsVersion: 20260805 }],
    ])('%s → invalid-argument 거부, 사용자 문서 조회도 하지 않는다', async (_label, overrides) => {
        await expect(capturedHandler(makeRequest(overrides))).rejects.toMatchObject({
            code: 'invalid-argument',
        });
        expect(mockUserGet).not.toHaveBeenCalled();
        expect(mockUserSet).not.toHaveBeenCalled();
    });
});
