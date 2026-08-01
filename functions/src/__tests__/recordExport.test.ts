/**
 * recordExport.test — 개인정보 반출 기록 (고시 제16조)
 *
 * 고정하는 계약:
 *  (1) 반출된 **데이터 내용**은 어떤 경로로도 로그에 들어가지 않는다 (키 집합 고정)
 *  (2) 형식·대상은 화이트리스트 — 임의 값 주입으로 로그를 오염시킬 수 없다
 *  (3) 행위자는 인증 토큰에서만 온다
 *  (4) 같은 반출의 재호출이 중복을 만들지 않는다
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

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: () => ({
            doc: (id: string) => {
                capturedDocIds.push(id);
                return { get: mockUserGet, set: mockSet };
            },
        }),
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

require('../handlers/callable/recordExport');

const EXPORT_ID = 'abcdef0123456789';
const lastEntry = () => mockSet.mock.calls[mockSet.mock.calls.length - 1][0];

const call = (data: any = {}, auth: any = { uid: 'user-1' }) =>
    capturedHandler({
        auth,
        data: { format: 'excel', dataset: 'driveLogs', recordCount: 42, exportId: EXPORT_ID, ...data },
    });

beforeEach(() => {
    jest.clearAllMocks();
    capturedDocIds.length = 0;
    mockSet.mockResolvedValue(undefined);
    mockUserGet.mockResolvedValue({ data: () => ({ organizationId: 'org-1' }) });
});

describe('recordExport — 입력 검증', () => {
    it('App Check를 강제한다', () => {
        expect(capturedOptions).toMatchObject({ region: 'asia-northeast3', enforceAppCheck: true });
    });

    it('비로그인 호출은 거부한다', async () => {
        await expect(call({}, null)).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('형식은 화이트리스트만 허용한다', async () => {
        for (const bad of ['csv', 'PDF', '', null, 123]) {
            await expect(call({ format: bad })).rejects.toMatchObject({ code: 'invalid-argument' });
        }
    });

    it('반출 대상은 화이트리스트만 허용한다 — 임의 값으로 로그를 오염시킬 수 없다', async () => {
        for (const bad of ['users', '홍길동-010-1234-5678', '', null]) {
            await expect(call({ dataset: bad })).rejects.toMatchObject({ code: 'invalid-argument' });
        }
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('건수는 0 이상 정수만 허용한다', async () => {
        for (const bad of [-1, 1.5, '42', null, NaN]) {
            await expect(call({ recordCount: bad })).rejects.toMatchObject({ code: 'invalid-argument' });
        }
    });

    it('0건 반출은 허용한다 — 시도 자체가 기록 대상이다', async () => {
        await call({ recordCount: 0 });
        expect(lastEntry().recordCount).toBe(0);
    });

    it('반출 식별자 형식이 어긋나면 거부한다 — 문서 ID에 들어가는 값이다', async () => {
        for (const bad of ['short', '../escape', 'has space', 'x'.repeat(65)]) {
            await expect(call({ exportId: bad })).rejects.toMatchObject({ code: 'invalid-argument' });
        }
    });

    it('대량 반출 탐지를 위한 한도를 적용한다', async () => {
        await call();
        expect(mockCheckRateLimit).toHaveBeenCalledWith('recordExport', 'user-1', 60, 3600);
    });
});

describe('recordExport — 기록 형식', () => {
    it('키 집합이 고정된다 — 반출 데이터가 새어 들어가면 실패한다', async () => {
        await call();
        expect(Object.keys(lastEntry()).sort()).toEqual([
            'action', 'actorSource', 'actorUid', 'at', 'expiresAt', 'exportDataset',
            'exportFormat', 'organizationId', 'recordCount', 'subjectUids', 'targetId', 'targetType',
        ]);
    });

    it('행위자는 인증 토큰에서만 온다', async () => {
        await call({ actorUid: 'someone-else' }, { uid: 'real-user' });
        expect(lastEntry()).toMatchObject({ actorUid: 'real-user', actorSource: 'auth' });
    });

    it('정보주체 목록은 비운다 — 채우면 로그가 uid 명단을 담게 된다', async () => {
        await call();
        expect(lastEntry().subjectUids).toEqual([]);
    });

    it('수행업무는 export, 대상 유형은 export로 남는다', async () => {
        await call();
        expect(lastEntry()).toMatchObject({
            action: 'export', targetType: 'export', targetId: 'driveLogs',
            exportFormat: 'excel', exportDataset: 'driveLogs', recordCount: 42,
        });
    });

    it('같은 반출 식별자의 재호출은 같은 문서를 덮어쓴다', async () => {
        await call();
        await call();
        const exportDocs = capturedDocIds.filter((id) => id.startsWith('export_'));
        expect(exportDocs).toEqual([`export_user-1_${EXPORT_ID}`, `export_user-1_${EXPORT_ID}`]);
    });

    it('PDF 반출도 같은 형식으로 남는다', async () => {
        await call({ format: 'pdf', dataset: 'maintenance', recordCount: 7 });
        expect(lastEntry()).toMatchObject({ exportFormat: 'pdf', exportDataset: 'maintenance', recordCount: 7 });
    });

    it('기관이 없는 계정은 __system__으로 남긴다', async () => {
        mockUserGet.mockResolvedValue({ data: () => ({}) });
        await call();
        expect(lastEntry().organizationId).toBe('__system__');
    });

    it('보관기간이 365일로 고정된다', async () => {
        const { Timestamp } = require('firebase-admin/firestore');
        const before = Date.now();
        await call();
        const ms = (Timestamp.fromMillis as jest.Mock).mock.calls[0][0];
        const days = (ms - before) / (24 * 60 * 60 * 1000);
        expect(days).toBeGreaterThan(364.9);
        expect(days).toBeLessThan(365.1);
    });
});
