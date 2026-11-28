/**
 * vehicleStatusApi.test.ts — 외부 연동 읽기 전용 API (GET /api/v1/vehicles)
 *
 * 고정하는 계약 (2026-11-28 도입):
 *   1. GET만 받는다. 응답은 캐시하지 않는다(no-store)
 *   2. 키는 Authorization: Bearer 또는 X-API-Key로 받고, 형식이 틀리면 DB를 읽지 않고 401
 *   3. 키 해시로 기관을 찾는다. 없는 키는 401
 *   4. 기관이 승인 상태가 아니거나 [외부 연동(API)]이 꺼져 있으면 403 — 키가 살아 있어도
 *   5. 응답은 차량 이름·번호판·누적 km·하이패스 잔액·카드 끝 4자리뿐이다. 퇴역 차량은 빠진다
 *   6. 기관이 하이패스를 끄면 카드 컬렉션을 읽지 않고 잔액은 null
 *   7. 기관당 호출 상한을 넘으면 429
 */

class MockTimestamp {
    constructor(private readonly ms: number) {}
    toMillis() { return this.ms; }
    toDate() { return new Date(this.ms); }
}

const mockKeyGet = jest.fn();
const mockKeyUpdate = jest.fn().mockResolvedValue(undefined);
const mockOrgGet = jest.fn();
const mockVehiclesGet = jest.fn();
const mockCardsGet = jest.fn();
const mockKeyDoc = jest.fn();

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => {
            if (name === 'externalApiKeys') {
                return { doc: (id: string) => { mockKeyDoc(id); return { get: mockKeyGet, update: mockKeyUpdate }; } };
            }
            if (name === 'organizations') return { doc: () => ({ get: mockOrgGet }) };
            if (name === 'vehicles') return { where: () => ({ get: mockVehiclesGet }) };
            if (name === 'hipassCards') return { where: () => ({ get: mockCardsGet }) };
            throw new Error(`예상하지 못한 컬렉션: ${name}`);
        },
    }),
    FieldValue: { serverTimestamp: () => 'SERVER_TS' },
    Timestamp: MockTimestamp,
}));

jest.mock('firebase-functions/v2/https', () => ({
    onRequest: (_opts: unknown, handler: unknown) => handler,
}));

jest.mock('../utils/helpers', () => ({
    wrapHttps: (_name: string, handler: unknown) => handler,
    log: jest.fn(),
}));

const mockIpLimit = jest.fn().mockResolvedValue(false);
const mockSubjectLimit = jest.fn().mockResolvedValue(false);
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByIp: (...args: unknown[]) => mockIpLimit(...args),
    checkRateLimitBySubject: (...args: unknown[]) => mockSubjectLimit(...args),
}));
jest.mock('../utils/clientIp', () => ({ resolveClientIp: () => '203.0.113.7' }));
jest.mock('../utils/constants', () => ({
    getRateLimits: async () => ({ max: 60, windowSec: 3600 }),
}));

import { vehicleStatusApi } from '../handlers/https/vehicleStatusApi';
import {
    API_KEY_PREFIX,
    apiKeyHint,
    extractApiKey,
    generateApiKey,
    hashApiKey,
    isWellFormedApiKey,
} from '../services/externalApi/apiKeys';

type Res = { status: jest.Mock; json: jest.Mock; set: jest.Mock };
function makeRes(): Res {
    const res: Res = { status: jest.fn(), json: jest.fn(), set: jest.fn() };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    res.set.mockReturnValue(res);
    return res;
}

const api = vehicleStatusApi as unknown as (req: unknown, res: unknown) => Promise<void>;

const KEY = generateApiKey();

function req(headers: Record<string, string> = { authorization: `Bearer ${KEY}` }, method = 'GET') {
    return { method, headers };
}

function docs(items: Array<{ id: string; data: Record<string, unknown> }>) {
    return { docs: items.map((d) => ({ id: d.id, data: () => d.data })) };
}

const approvedOrg = { exists: true, data: () => ({ name: '행복복지관', status: 'approved', externalApiEnabled: true }) };

describe('apiKeys — 키 만들기·형식·헤더', () => {
    it('발급한 키는 접두사 + 43자이고 형식 검사를 통과한다', () => {
        const key = generateApiKey();
        expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
        expect(key).toHaveLength(API_KEY_PREFIX.length + 43);
        expect(isWellFormedApiKey(key)).toBe(true);
        expect(generateApiKey()).not.toBe(key);
    });

    it('형식이 틀린 값은 거른다', () => {
        expect(isWellFormedApiKey(undefined)).toBe(false);
        expect(isWellFormedApiKey('')).toBe(false);
        expect(isWellFormedApiKey('dlk_short')).toBe(false);
        expect(isWellFormedApiKey(`xxx_${'a'.repeat(43)}`)).toBe(false);
    });

    it('해시는 키마다 고정되고 원래 키를 담지 않는다', () => {
        expect(hashApiKey(KEY)).toBe(hashApiKey(KEY));
        expect(hashApiKey(KEY)).toMatch(/^[0-9a-f]{64}$/);
        expect(hashApiKey(KEY)).not.toContain(KEY.slice(4, 12));
        expect(apiKeyHint(KEY)).toBe(KEY.slice(-4));
    });

    it('Bearer와 X-API-Key를 받고, 그 밖은 null', () => {
        expect(extractApiKey({ authorization: `Bearer ${KEY}` })).toBe(KEY);
        expect(extractApiKey({ authorization: `bearer ${KEY}` })).toBe(KEY);
        expect(extractApiKey({ 'x-api-key': ` ${KEY} ` })).toBe(KEY);
        expect(extractApiKey({ authorization: `Basic ${KEY}` })).toBeNull();
        expect(extractApiKey({})).toBeNull();
        expect(extractApiKey(undefined)).toBeNull();
    });
});

describe('vehicleStatusApi — 외부 연동 조회', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIpLimit.mockResolvedValue(false);
        mockSubjectLimit.mockResolvedValue(false);
        mockKeyGet.mockResolvedValue({ exists: true, data: () => ({ organizationId: 'org1', lastUsedAt: null }) });
        mockOrgGet.mockResolvedValue(approvedOrg);
        mockVehiclesGet.mockResolvedValue(docs([
            { id: 'v2', data: { organizationId: 'org1', displayName: '카니발', name: 'KA4', plateNumber: '12가3456', currentKm: 45210 } },
            { id: 'v1', data: { organizationId: 'org1', displayName: '스타렉스', name: '스타렉스', plateNumber: '34나5678', currentKm: '120333' } },
            { id: 'v3', data: { organizationId: 'org1', displayName: '옛 차', plateNumber: '56다7890', currentKm: 99, retired: { isRetired: true } } },
        ]));
        mockCardsGet.mockResolvedValue(docs([
            { id: 'c1', data: { organizationId: 'org1', vehicleId: 'v1', cardNumber: '1234-5678-9012-3456', balance: 23000 } },
        ]));
    });

    it('GET이 아니면 405', async () => {
        const res = makeRes();
        await api(req(undefined, 'POST'), res);
        expect(res.status).toHaveBeenCalledWith(405);
        expect(mockKeyGet).not.toHaveBeenCalled();
    });

    it('응답은 캐시하지 않는다', async () => {
        const res = makeRes();
        await api(req(), res);
        expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    });

    it('키가 없거나 형식이 틀리면 DB를 읽지 않고 401', async () => {
        for (const headers of [{}, { authorization: 'Bearer abc' }, { 'x-api-key': 'dlk_123' }]) {
            const res = makeRes();
            await api(req(headers), res);
            expect(res.status).toHaveBeenCalledWith(401);
        }
        expect(mockKeyGet).not.toHaveBeenCalled();
    });

    it('키는 해시로 찾는다 — 없는 키는 401', async () => {
        mockKeyGet.mockResolvedValueOnce({ exists: false, data: () => undefined });
        const res = makeRes();
        await api(req(), res);
        expect(mockKeyDoc).toHaveBeenCalledWith(hashApiKey(KEY));
        expect(res.status).toHaveBeenCalledWith(401);
        expect(mockOrgGet).not.toHaveBeenCalled();
    });

    it('기관이 [외부 연동(API)]을 끄면 키가 살아 있어도 403', async () => {
        mockOrgGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'approved' }) });
        const res = makeRes();
        await api(req(), res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(mockVehiclesGet).not.toHaveBeenCalled();
    });

    it('승인 상태가 아닌 기관(해지 등)은 403', async () => {
        mockOrgGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'deleted', externalApiEnabled: true }) });
        const res = makeRes();
        await api(req(), res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(mockVehiclesGet).not.toHaveBeenCalled();
    });

    it('기관당 상한을 넘으면 429', async () => {
        mockSubjectLimit.mockResolvedValueOnce(true);
        const res = makeRes();
        await api(req(), res);
        expect(mockSubjectLimit).toHaveBeenCalledWith('vehicleStatusApi', 'org_org1', 60, 3600);
        expect(res.status).toHaveBeenCalledWith(429);
        expect(mockVehiclesGet).not.toHaveBeenCalled();
    });

    it('인증 전 IP 상한을 넘으면 429 — 키를 읽지 않는다', async () => {
        mockIpLimit.mockResolvedValueOnce(true);
        const res = makeRes();
        await api(req(), res);
        expect(res.status).toHaveBeenCalledWith(429);
        expect(mockKeyGet).not.toHaveBeenCalled();
    });

    it('정상 — 운행 중인 차량의 km·하이패스 잔액만, 이름순으로', async () => {
        const res = makeRes();
        await api(req(), res);
        expect(res.status).toHaveBeenCalledWith(200);
        const body = res.json.mock.calls[0][0];
        expect(body.organizationName).toBe('행복복지관');
        expect(typeof body.generatedAt).toBe('string');
        expect(body.vehicles).toEqual([
            { id: 'v1', name: '스타렉스', plateNumber: '34나5678', currentKm: 120333, hipassBalance: 23000, hipassCardLast4: '3456' },
            { id: 'v2', name: '카니발', plateNumber: '12가3456', currentKm: 45210, hipassBalance: null, hipassCardLast4: null },
        ]);
    });

    it('X-API-Key 헤더로도 된다', async () => {
        const res = makeRes();
        await api(req({ 'x-api-key': KEY }), res);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('기관이 하이패스를 끄면 카드를 읽지 않고 잔액은 null', async () => {
        mockOrgGet.mockResolvedValueOnce({ exists: true, data: () => ({ name: '행복복지관', status: 'approved', externalApiEnabled: true, hipassEnabled: false }) });
        const res = makeRes();
        await api(req(), res);
        expect(mockCardsGet).not.toHaveBeenCalled();
        const body = res.json.mock.calls[0][0];
        expect(body.vehicles.every((v: { hipassBalance: unknown }) => v.hipassBalance === null)).toBe(true);
    });

    it('마지막 사용 시각은 1시간이 지났을 때만 갱신한다', async () => {
        await api(req(), makeRes());
        expect(mockKeyUpdate).toHaveBeenCalledWith({ lastUsedAt: 'SERVER_TS' });

        mockKeyUpdate.mockClear();
        mockKeyGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ organizationId: 'org1', lastUsedAt: new MockTimestamp(Date.now() - 5 * 60 * 1000) }),
        });
        await api(req(), makeRes());
        expect(mockKeyUpdate).not.toHaveBeenCalled();
    });

    it('마지막 사용 시각 갱신이 실패해도 응답은 200', async () => {
        mockKeyUpdate.mockRejectedValueOnce(new Error('NOT_FOUND'));
        const res = makeRes();
        await api(req(), res);
        expect(res.status).toHaveBeenCalledWith(200);
    });
});
