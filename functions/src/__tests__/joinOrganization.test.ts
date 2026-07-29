/**
 * joinOrganization.test — 이용약관 동의 검증·기록
 *
 * joinOrganization.emulator.test.ts는 핸들러 로직을 복제해 검증하므로 실제 배포되는
 * 코드를 보장하지 못한다. 이 파일은 onCall 핸들러를 그대로 캡처해 실제 코드를 검증한다.
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

// ── Firestore Mock ──
// 핸들러가 타는 체인만 최소로 재현한다.
const mockUserSet = jest.fn().mockResolvedValue(undefined);
const mockPreRegDelete = jest.fn().mockResolvedValue(undefined);
let mockOrgDocs: any[] = [];
let mockExistingUser: any = { exists: false, data: () => undefined };
let mockMemberDocs: any[] = [];
let mockPreRegDocs: any[] = [];

/** where()/limit() 체인을 무시하고 지정된 docs를 돌려주는 쿼리 스텁 */
const makeQuery = (getDocs: () => any[]): any => ({
    where: () => makeQuery(getDocs),
    limit: () => makeQuery(getDocs),
    get: async () => {
        const docs = getDocs();
        return { empty: docs.length === 0, docs };
    },
});

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => {
            if (name === 'organizations') {
                return {
                    ...makeQuery(() => mockOrgDocs),
                    doc: () => ({
                        collection: () => ({
                            ...makeQuery(() => mockPreRegDocs),
                            doc: () => ({ delete: mockPreRegDelete }),
                        }),
                    }),
                };
            }
            // users
            return {
                ...makeQuery(() => mockMemberDocs),
                doc: () => ({
                    get: async () => mockExistingUser,
                    set: mockUserSet,
                }),
            };
        },
    }),
    FieldValue: {
        serverTimestamp: jest.fn(() => 'mock-timestamp'),
    },
}));

const mockSetCustomUserClaims = jest.fn().mockResolvedValue(undefined);
jest.mock('firebase-admin/auth', () => ({
    getAuth: () => ({ setCustomUserClaims: mockSetCustomUserClaims }),
}));

// rate limit은 이 테스트의 관심사가 아니므로 항상 통과
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByUid: jest.fn().mockResolvedValue(undefined),
}));

// 모듈 로드 (capturedHandler 설정)
require('../handlers/callable/joinOrganization');

describe('joinOrganization — 이용약관 동의', () => {
    const makeRequest = (data: Record<string, unknown> = {}) => ({
        auth: {
            uid: 'user-001',
            token: {
                email: 'employee@example.com',
                name: '홍길동',
                firebase: { sign_in_provider: 'google.com' },
            },
        },
        data: { code: 'ABC123', agreedTerms: true, termsVersion: '2026-08-05', ...data },
    });

    beforeEach(() => {
        jest.clearAllMocks();
        // 승인된 기관 1건, 기존 admin 1명(→ 신규 가입자는 employee)
        mockOrgDocs = [{ id: 'org-1', data: () => ({ name: '테스트복지관' }) }];
        mockExistingUser = { exists: false, data: () => undefined };
        mockMemberDocs = [{ data: () => ({ email: 'admin@example.com', role: 'admin' }) }];
        mockPreRegDocs = [];
    });

    it('동의 사실·버전·서버 시각을 사용자 문서에 저장한다', async () => {
        await capturedHandler(makeRequest());

        expect(mockUserSet).toHaveBeenCalledTimes(1);
        const savedDoc = mockUserSet.mock.calls[0][0];
        expect(savedDoc.consent).toEqual({
            terms: true,
            termsVersion: '2026-08-05',
            agreedAt: 'mock-timestamp',
        });
    });

    it('개인정보 처리방침 동의는 받지도, 기록하지도 않는다', async () => {
        await capturedHandler(makeRequest());
        const savedDoc = mockUserSet.mock.calls[0][0];
        // 직원 개인정보의 처리 근거는 동의가 아니라 기관의 업무 수행이다.
        // privacy 항목이 생기면 동의 철회 시 운행일지를 쓸 수 없는 모순이 발생한다.
        expect(savedDoc.consent).not.toHaveProperty('privacy');
        expect(savedDoc.consent).not.toHaveProperty('privacyVersion');
    });

    it.each([
        ['agreedTerms 누락', { agreedTerms: undefined }],
        ['agreedTerms=false', { agreedTerms: false }],
        ['boolean이 아닌 truthy 값', { agreedTerms: 'yes' }],
    ])('%s → invalid-argument 거부, 사용자 문서 미생성', async (_label, overrides) => {
        await expect(
            capturedHandler(makeRequest(overrides))
        ).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockUserSet).not.toHaveBeenCalled();
        expect(mockSetCustomUserClaims).not.toHaveBeenCalled();
    });

    it.each([
        ['termsVersion 누락', { termsVersion: undefined }],
        ['빈 문자열', { termsVersion: '' }],
        ['타입 불일치', { termsVersion: 20260805 }],
        ['형식 불일치(자유 문자열)', { termsVersion: 'latest' }],
        ['형식 불일치(구분자 없음)', { termsVersion: '20260805' }],
    ])('termsVersion %s → invalid-argument 거부', async (_label, overrides) => {
        await expect(
            capturedHandler(makeRequest(overrides))
        ).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockUserSet).not.toHaveBeenCalled();
    });

    it('동의 검증은 기관 조회보다 앞선다 — 동의 없는 요청은 Firestore를 읽지 않는다', async () => {
        // 초대 코드가 유효해도 동의가 없으면 조회 이전에 거부되어야 한다
        await expect(
            capturedHandler(makeRequest({ agreedTerms: false }))
        ).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockUserSet).not.toHaveBeenCalled();
        expect(mockPreRegDelete).not.toHaveBeenCalled();
    });

    it('초대 코드 검증은 동의 검증보다 앞선다 — 코드가 틀리면 동의 여부와 무관하게 거부', async () => {
        await expect(
            capturedHandler(makeRequest({ code: 'ABC', agreedTerms: false }))
        ).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockUserSet).not.toHaveBeenCalled();
    });

    it('동의가 있으면 기존 가입 로직(역할 판정·Claims 설정)은 그대로 동작한다', async () => {
        const result = await capturedHandler(makeRequest());

        expect(result).toMatchObject({ success: true, orgId: 'org-1', orgName: '테스트복지관', role: 'employee' });
        expect(mockSetCustomUserClaims).toHaveBeenCalledWith('user-001', { role: 'employee', orgId: 'org-1' });
    });
});
