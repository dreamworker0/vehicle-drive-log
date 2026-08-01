/**
 * recordSession.test — 로그인 세션 기록 (고시 제16조의 접속지 정보)
 *
 * 고정하는 계약은 넷이다.
 *  (1) 접속지 IP를 프록시 체인이 아니라 **원 클라이언트**로 뽑는다
 *  (2) User-Agent 원문을 저장하지 않는다 (기기 지문화 방지)
 *  (3) 문서 ID가 세션 단위로 고정돼 재호출이 중복을 만들지 않는다
 *  (4) 행위자는 인증 토큰에서만 온다 — 클라이언트가 보내는 값을 믿지 않는다
 */

let capturedHandler: any;
let capturedOptions: any;

class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

jest.mock('firebase-functions/v2/https', () => ({
    onCall: (options: any, handler: any) => {
        capturedOptions = options;
        capturedHandler = handler;
    },
    HttpsError: MockHttpsError,
}));

const mockUserGet = jest.fn();
const mockSet = jest.fn().mockResolvedValue(undefined);
const capturedDocIds: string[] = [];
const capturedCollections: string[] = [];

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => {
            capturedCollections.push(name);
            return {
                doc: (id: string) => {
                    capturedDocIds.push(id);
                    return { get: mockUserGet, set: mockSet };
                },
            };
        },
    }),
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TS') },
    Timestamp: { fromMillis: jest.fn((ms: number) => ({ __ms: ms })) },
}));

const mockCheckRateLimit = jest.fn().mockResolvedValue(undefined);
jest.mock('../utils/helpers', () => ({
    log: jest.fn(),
    wrapHandler: (_name: string, handler: any) => handler,
}));
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByUid: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

require('../handlers/callable/recordSession');

const SESSION = 'a1b2c3d4e5f60718';

/** 마지막으로 기록된 감사 엔트리 */
const lastEntry = () => mockSet.mock.calls[mockSet.mock.calls.length - 1][0];

const call = (overrides: any = {}) =>
    capturedHandler({
        auth: { uid: 'user-1' },
        data: { sessionId: SESSION },
        rawRequest: { headers: {}, ip: '203.0.113.9' },
        ...overrides,
    });

beforeEach(() => {
    jest.clearAllMocks();
    capturedDocIds.length = 0;
    capturedCollections.length = 0;
    mockSet.mockResolvedValue(undefined);
    mockUserGet.mockResolvedValue({ data: () => ({ organizationId: 'org-1' }) });
});

describe('recordSession — 인증·입력 검증', () => {
    it('App Check를 강제한다 (무단 호출로 감사 로그를 오염시키는 경로 차단)', () => {
        expect(capturedOptions).toMatchObject({ region: 'asia-northeast3', enforceAppCheck: true });
    });

    it('비로그인 호출은 거부한다', async () => {
        await expect(call({ auth: null })).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('세션 식별자 형식이 어긋나면 거부한다 — 문서 ID에 들어가는 값이다', async () => {
        for (const bad of ['짧음', 'has space', '../escape', 'x'.repeat(65), '']) {
            await expect(call({ data: { sessionId: bad } })).rejects.toMatchObject({ code: 'invalid-argument' });
        }
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('세션 식별자가 없으면 거부한다', async () => {
        await expect(call({ data: {} })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('남용 방지 한도를 적용한다', async () => {
        await call();
        expect(mockCheckRateLimit).toHaveBeenCalledWith('recordSession', 'user-1', 20, 3600);
    });
});

describe('recordSession — 접속지 IP', () => {
    it('x-forwarded-for의 첫 번째 값을 원 클라이언트로 본다 (뒤는 프록시 체인)', async () => {
        await call({ rawRequest: { headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1, 10.0.0.2' }, ip: '10.0.0.2' } });
        expect(lastEntry().ip).toBe('198.51.100.7');
    });

    it('헤더 배열로 들어와도 첫 값을 쓴다', async () => {
        await call({ rawRequest: { headers: { 'x-forwarded-for': ['198.51.100.8, 10.0.0.1'] }, ip: '10.0.0.2' } });
        expect(lastEntry().ip).toBe('198.51.100.8');
    });

    it('헤더가 없으면 요청 IP로 대체한다', async () => {
        await call({ rawRequest: { headers: {}, ip: '203.0.113.9' } });
        expect(lastEntry().ip).toBe('203.0.113.9');
    });

    it('IP를 전혀 알 수 없으면 null로 남기고 지어내지 않는다', async () => {
        await call({ rawRequest: { headers: {} } });
        expect(lastEntry().ip).toBeNull();
    });
});

describe('recordSession — 접속 환경 축약', () => {
    const ua = (s: string) => ({ rawRequest: { headers: { 'user-agent': s }, ip: '203.0.113.9' } });

    it('브라우저·OS 종류만 남기고 원문·버전은 저장하지 않는다', async () => {
        await call(ua('Mozilla/5.0 (Linux; Android 14; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36'));
        expect(lastEntry().userAgent).toBe('Chrome / Android');
        // 기기 모델(SM-S911N)·상세 버전이 새어 들어가면 접속기록이 기기 지문이 된다
        expect(JSON.stringify(lastEntry())).not.toContain('SM-S911N');
        expect(JSON.stringify(lastEntry())).not.toContain('126.0');
    });

    it('Edge를 Chrome으로 오분류하지 않는다 (UA가 서로를 포함한다)', async () => {
        await call(ua('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'));
        expect(lastEntry().userAgent).toBe('Edge / Windows');
    });

    it('삼성 인터넷을 Chrome으로 오분류하지 않는다', async () => {
        await call(ua('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36'));
        expect(lastEntry().userAgent).toBe('Samsung Internet / Android');
    });

    it('iOS Safari를 구분한다', async () => {
        await call(ua('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1'));
        expect(lastEntry().userAgent).toBe('Safari / iOS');
    });

    it('User-Agent가 없으면 unknown으로 남긴다', async () => {
        await call({ rawRequest: { headers: {}, ip: '203.0.113.9' } });
        expect(lastEntry().userAgent).toBe('unknown');
    });
});

describe('recordSession — 기록 형식', () => {
    it('감사 로그의 키 집합이 고정된다 — 값 필드가 새로 끼어들면 실패한다', async () => {
        await call();
        expect(Object.keys(lastEntry()).sort()).toEqual([
            'action', 'actorSource', 'actorUid', 'at', 'expiresAt',
            'ip', 'organizationId', 'subjectUids', 'targetId', 'targetType', 'userAgent',
        ]);
    });

    it('행위자는 인증 토큰에서만 온다 — 클라이언트가 보낸 uid를 믿지 않는다', async () => {
        await call({ auth: { uid: 'real-user' }, data: { sessionId: SESSION, actorUid: 'someone-else' } });
        expect(lastEntry()).toMatchObject({
            actorUid: 'real-user', actorSource: 'auth', subjectUids: ['real-user'],
        });
    });

    it('수행업무는 login, 대상은 session으로 남는다', async () => {
        await call();
        expect(lastEntry()).toMatchObject({ action: 'login', targetType: 'session', targetId: SESSION });
    });

    it('문서 ID가 세션 단위로 고정돼 재호출이 중복을 만들지 않는다', async () => {
        await call();
        await call();
        expect(capturedDocIds.filter((id) => id.startsWith('session_'))).toEqual([
            `session_user-1_${SESSION}`,
            `session_user-1_${SESSION}`,
        ]);
    });

    it('감사 로그는 auditLogs 컬렉션에만 쓴다', async () => {
        await call();
        expect(capturedCollections).toEqual(['users', 'auditLogs']);
    });

    it('보관기간이 365일로 고정된다 (변경 로그와 동일)', async () => {
        const { Timestamp } = require('firebase-admin/firestore');
        const before = Date.now();
        await call();
        const ms = (Timestamp.fromMillis as jest.Mock).mock.calls[0][0];
        const days = (ms - before) / (24 * 60 * 60 * 1000);
        expect(days).toBeGreaterThan(364.9);
        expect(days).toBeLessThan(365.1);
    });

    it('기관이 없는 계정(superAdmin)은 __system__으로 남긴다', async () => {
        mockUserGet.mockResolvedValue({ data: () => ({}) });
        await call();
        expect(lastEntry().organizationId).toBe('__system__');
    });

    it('사용자 문서가 없어도 기록은 남긴다 — 접속 사실이 사라지면 안 된다', async () => {
        mockUserGet.mockResolvedValue({ data: () => undefined });
        await call();
        expect(lastEntry().organizationId).toBe('__system__');
        expect(mockSet).toHaveBeenCalled();
    });
});
