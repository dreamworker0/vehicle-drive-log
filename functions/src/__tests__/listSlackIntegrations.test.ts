/**
 * listSlackIntegrations.test.ts — 슈퍼관리자 전체 Slack 연결 기관 현황 콜러블
 * 검증: superAdmin 게이트, 기관명 조인, active 계산·정렬, 토큰·암호문 미노출.
 */
class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
}
const capturedHandlers: any[] = [];
jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_options: any, handler: any) => { capturedHandlers.push(handler); return handler; },
    HttpsError: MockHttpsError,
}));

const mockUserGet = jest.fn();         // (uid) => userSnap
const mockIntegrationsGet = jest.fn(); // () => snapshot
const mockOrgGet = jest.fn();          // (orgId) => orgSnap

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => {
            if (name === 'users') return { doc: (uid: string) => ({ get: () => mockUserGet(uid) }) };
            if (name === 'integrations') return { where: () => ({ get: () => mockIntegrationsGet() }) };
            if (name === 'organizations') return { doc: (id: string) => ({ get: () => mockOrgGet(id) }) };
            throw new Error(`예상치 못한 컬렉션 접근: ${name}`);
        },
    }),
}));

require('../handlers/callable/listSlackIntegrations');
const [handler] = capturedHandlers;

const SUPER_REQ = { auth: { uid: 'sa1' } };
const CIPHER = { v: 1, cipher: 'c', iv: 'i', authTag: 't' };

/** integrations 스냅샷 doc 헬퍼 */
function doc(data: Record<string, unknown>) {
    return { data: () => data };
}

describe('listSlackIntegrations — 권한 게이트', () => {
    beforeEach(() => jest.clearAllMocks());

    it('미인증이면 거부한다', async () => {
        await expect(handler({ auth: null })).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('superAdmin이 아니면 거부한다', async () => {
        mockUserGet.mockResolvedValue({ data: () => ({ role: 'admin' }) });
        await expect(handler(SUPER_REQ)).rejects.toMatchObject({ code: 'permission-denied' });
    });
});

describe('listSlackIntegrations — 현황 반환', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUserGet.mockResolvedValue({ data: () => ({ role: 'superAdmin' }) });
        mockOrgGet.mockImplementation((id: string) =>
            Promise.resolve({ data: () => ({ name: id === 'org1' ? '사랑나눔복지관' : '햇살복지재단' }) }));
    });

    it('기관명을 조인하고 활성 우선 정렬 + activeCount를 반환한다 (토큰·암호문 미포함)', async () => {
        mockIntegrationsGet.mockResolvedValue({
            docs: [
                // 해제된 연동 (뒤로 정렬돼야 함)
                doc({
                    platform: 'slack', organizationId: 'org2', teamName: '햇살',
                    botUserId: 'B2', enabled: false, revoked: true, tokenCipher: CIPHER,
                    disconnectedAt: { toDate: () => new Date('2026-07-10T00:00:00Z') },
                }),
                // 활성 연동
                doc({
                    platform: 'slack', organizationId: 'org1', teamName: '사랑나눔',
                    botUserId: 'B1', enabled: true, revoked: false, tokenCipher: CIPHER,
                    connectedAt: { toDate: () => new Date('2026-07-18T00:00:00Z') },
                }),
            ],
        });

        const result = await handler(SUPER_REQ);

        expect(result.activeCount).toBe(1);
        expect(result.integrations).toEqual([
            {
                organizationId: 'org1', organizationName: '사랑나눔복지관', teamName: '사랑나눔',
                botUserId: 'B1', active: true,
                connectedAt: '2026-07-18T00:00:00.000Z', disconnectedAt: null,
            },
            {
                organizationId: 'org2', organizationName: '햇살복지재단', teamName: '햇살',
                botUserId: 'B2', active: false,
                connectedAt: null, disconnectedAt: '2026-07-10T00:00:00.000Z',
            },
        ]);
        // 토큰/암호문은 절대 새 나가지 않는다
        expect(JSON.stringify(result)).not.toContain('cipher');
        expect(JSON.stringify(result)).not.toContain('tokenCipher');
    });

    it('연동 기관이 없으면 빈 목록 + activeCount 0', async () => {
        mockIntegrationsGet.mockResolvedValue({ docs: [] });
        const result = await handler(SUPER_REQ);
        expect(result).toEqual({ integrations: [], activeCount: 0 });
    });
});
