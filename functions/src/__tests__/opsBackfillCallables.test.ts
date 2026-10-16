/**
 * opsBackfillCallables.test.ts — superAdmin 운영 도구(backfillOrgCoords·recalculateAggregatedStats)
 * - backfillOrgCoords: superAdmin만, 승인 기관 중 좌표 없는 곳만, POI → 주소 검색 순 폴백,
 *   AI 판독 주소로 주소까지 채움, 실패·예외는 건수로만(중단하지 않음)
 * - recalculateAggregatedStats: users 문서의 역할로 superAdmin 확인(토큰 역할은 믿지 않는다),
 *   기관별 driveLogs 조회는 organizationId 필터, 음수 거리 0, KST 월 키, 통계 문서 덮어쓰기
 */

const mockOrgQueryGet = jest.fn();
const mockDriveLogsWhere = jest.fn();
const mockStatsSet = jest.fn().mockResolvedValue(undefined);
const mockUserGet = jest.fn();
const mockAllOrgsGet = jest.fn();

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => {
            if (name === 'users') return { doc: () => ({ get: mockUserGet }) };
            if (name === 'driveLogs') {
                return { where: (...args: unknown[]) => { mockDriveLogsWhere(...args); return { get: () => mockDriveLogsWhere.getResult(args[2]) }; } };
            }
            // organizations
            return {
                where: () => ({ get: mockOrgQueryGet }),
                get: mockAllOrgsGet,
                doc: (orgId: string) => ({ collection: () => ({ doc: (id: string) => ({ set: (...a: unknown[]) => mockStatsSet(orgId, id, ...a) }) }) }),
            };
        },
    }),
}));
jest.mock('firebase-functions/params', () => ({ defineString: () => ({ value: () => 'tmap-key' }) }));
jest.mock('../core/sentry', () => ({ captureError: jest.fn(), flushSentry: jest.fn() }));
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }));
const httpsMock = {
    onCall: (_opts: unknown, handler: (req: unknown) => unknown) => handler,
    HttpsError: class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
};
jest.mock('firebase-functions/v2/https', () => httpsMock);
jest.mock('firebase-functions/https', () => httpsMock);

import { backfillOrgCoords } from '../handlers/callable/backfillOrgCoords';
import { recalculateAggregatedStats } from '../handlers/callable/recalculateAggregatedStats';

type Handler = (req: Record<string, unknown>) => Promise<Record<string, unknown>>;
const superAdminToken = { uid: 'sa1', token: { role: 'superAdmin' } };

const orgDoc = (id: string, data: Record<string, unknown>) => {
    const update = jest.fn().mockResolvedValue(undefined);
    return { id, data: () => data, ref: { update } };
};
const jsonRes = (body: unknown) => ({ json: async () => body }) as unknown as Response;
const poi = (lat: string, lon: string) => jsonRes({ searchPoiInfo: { pois: { poi: [{ noorLat: lat, noorLon: lon }] } } });
const geo = (lat: string, lon: string) => jsonRes({ coordinateInfo: { coordinate: [{ newLat: lat, newLon: lon, lat: '', lon: '' }] } });
const empty = () => jsonRes({});

let fetchSpy: jest.SpyInstance;
beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchSpy = jest.spyOn(globalThis, 'fetch');
});
afterEach(() => jest.restoreAllMocks());

describe('backfillOrgCoords', () => {
    const handler = backfillOrgCoords as unknown as Handler;

    it.each([
        ['로그인 안 함', null, 'unauthenticated'],
        ['기관 관리자', { uid: 'a1', token: { role: 'admin' } }, 'permission-denied'],
    ])('%s은 거부한다', async (_label, auth, code) => {
        await expect(handler({ auth, data: {} })).rejects.toMatchObject({ code });
        expect(mockOrgQueryGet).not.toHaveBeenCalled();
    });

    it('좌표가 이미 있거나 주소가 없는 기관은 건너뛰고, 나머지는 POI → 주소 검색 순으로 채운다', async () => {
        const hasCoords = orgDoc('o1', { name: '좌표 있음', address: '서울', lat: 37.5, lng: 127 });
        const noAddress = orgDoc('o2', { name: '주소 없음' });
        const byPoi = orgDoc('o3', { name: 'POI', address: '서울 중구 세종대로 110' });
        const byGeo = orgDoc('o4', { name: '주소 검색', address: '부산 해운대구 1' });
        const fromAi = orgDoc('o5', { name: 'AI 주소', aiVerifyDetail: { address: '대전 서구 2' } });
        const failed = orgDoc('o6', { name: '실패', address: '없는 주소' });
        mockOrgQueryGet.mockResolvedValueOnce({ size: 6, docs: [hasCoords, noAddress, byPoi, byGeo, fromAi, failed] });

        fetchSpy
            .mockResolvedValueOnce(poi('37.56', '126.97'))               // o3: POI 성공
            .mockResolvedValueOnce(empty()).mockResolvedValueOnce(geo('35.16', '129.16')) // o4: POI 없음 → 주소 검색
            .mockResolvedValueOnce(poi('36.35', '127.38'))               // o5
            .mockResolvedValueOnce(empty()).mockResolvedValueOnce(empty()); // o6: 둘 다 없음

        await expect(handler({ auth: superAdminToken, data: {} })).resolves.toEqual({ total: 6, updated: 3, skipped: 2, failed: 1 });

        expect(hasCoords.ref.update).not.toHaveBeenCalled();
        expect(noAddress.ref.update).not.toHaveBeenCalled();
        expect(byPoi.ref.update).toHaveBeenCalledWith({ lat: 37.56, lng: 126.97 });
        expect(byGeo.ref.update).toHaveBeenCalledWith({ lat: 35.16, lng: 129.16 });
        // 주소 필드가 비어 있던 기관은 AI 판독 주소도 함께 채운다
        expect(fromAi.ref.update).toHaveBeenCalledWith({ lat: 36.35, lng: 127.38, address: '대전 서구 2' });
        expect(failed.ref.update).not.toHaveBeenCalled();

        // Tmap 키는 헤더로, 주소는 인코딩해서 보낸다
        const [url, init] = fetchSpy.mock.calls[0];
        expect(String(url)).toContain(`searchKeyword=${encodeURIComponent('서울 중구 세종대로 110')}`);
        expect(init).toEqual({ headers: { appKey: 'tmap-key' } });
    });

    it('Tmap 호출이 예외를 내도 그 기관만 실패로 세고 계속한다', async () => {
        const a = orgDoc('o1', { name: 'A', address: '서울' });
        const b = orgDoc('o2', { name: 'B', address: '부산' });
        mockOrgQueryGet.mockResolvedValueOnce({ size: 2, docs: [a, b] });
        fetchSpy.mockRejectedValueOnce(new Error('ETIMEDOUT')).mockResolvedValueOnce(poi('35.1', '129.0'));

        await expect(handler({ auth: superAdminToken, data: {} })).resolves.toEqual({ total: 2, updated: 1, skipped: 0, failed: 1 });
        expect(b.ref.update).toHaveBeenCalledWith({ lat: 35.1, lng: 129 });
    });
});

describe('recalculateAggregatedStats', () => {
    const handler = recalculateAggregatedStats as unknown as Handler;
    const ts = (iso: string) => ({ toDate: () => new Date(iso) });
    const logs: Record<string, Array<Record<string, unknown>>> = {};
    beforeAll(() => {
        (mockDriveLogsWhere as unknown as { getResult: (org: string) => Promise<unknown> }).getResult =
            async (org: string) => ({ docs: (logs[org] ?? []).map((d) => ({ data: () => d })) });
    });

    it('로그인하지 않으면 거부한다', async () => {
        await expect(handler({ auth: null, data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('users 문서의 역할로 확인한다 — 토큰에 superAdmin이 있어도 문서가 아니면 거부', async () => {
        mockUserGet.mockResolvedValueOnce({ data: () => ({ role: 'admin' }) });
        await expect(handler({ auth: superAdminToken, data: {} })).rejects.toMatchObject({ code: 'permission-denied' });
        mockUserGet.mockResolvedValueOnce({ data: () => undefined });
        await expect(handler({ auth: superAdminToken, data: {} })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockStatsSet).not.toHaveBeenCalled();
    });

    it('특정 기관만: organizationId로 걸러 합계·KST 월별 통계를 덮어쓴다', async () => {
        mockUserGet.mockResolvedValueOnce({ data: () => ({ role: 'superAdmin' }) });
        logs.org1 = [
            { startKm: 100, endKm: 130, timestamp: ts('2026-09-30T15:30:00Z') }, // KST 10-01 00:30
            { startKm: 130, endKm: 150, timestamp: ts('2026-10-05T01:00:00Z') },
            { startKm: 200, endKm: 190, timestamp: ts('2026-10-06T01:00:00Z') }, // 음수 → 0
            { startKm: 10, endKm: 15 },                                           // 시각 없음 → 합계에만
        ];

        await expect(handler({ auth: superAdminToken, data: { organizationId: 'org1' } }))
            .resolves.toEqual({ success: true, processedCount: 1 });

        expect(mockDriveLogsWhere).toHaveBeenCalledWith('organizationId', '==', 'org1');
        expect(mockAllOrgsGet).not.toHaveBeenCalled();
        const [orgId, docId, stats, options] = mockStatsSet.mock.calls[0];
        expect([orgId, docId]).toEqual(['org1', 'aggregate']);
        expect(stats).toMatchObject({
            count: 4,
            totalDistance: 55,
            monthlyStats: { '2026-10': { count: 3, totalDistance: 50 } },
        });
        expect(options).toEqual({ merge: false });
    });

    it('기관을 지정하지 않으면 모든 기관을 차례로 처리한다', async () => {
        mockUserGet.mockResolvedValueOnce({ data: () => ({ role: 'superAdmin' }) });
        mockAllOrgsGet.mockResolvedValueOnce({ docs: [{ id: 'a' }, { id: 'b' }] });
        logs.a = [];
        logs.b = [{ startKm: 0, endKm: 7, timestamp: ts('2026-10-10T00:00:00Z') }];

        await expect(handler({ auth: superAdminToken, data: undefined })).resolves.toEqual({ success: true, processedCount: 2 });
        expect(mockStatsSet.mock.calls.map((c) => [c[0], c[2].count, c[2].totalDistance])).toEqual([['a', 0, 0], ['b', 1, 7]]);
    });
});
