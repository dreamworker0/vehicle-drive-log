/**
 * tmap/core.test.ts — T-Map 호출 코어(쿨다운·요청 큐·캐시·fetch 래퍼) 테스트
 *
 * 이 모듈이 무너지면 무료 API 쿼터를 태우거나(429 폭주) 조용히 경로 조회가 멈춘다.
 * 실패 누적 규칙과 fetch 응답 처리 분기를 고정한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// authFetch는 firebase 초기화를 끌고 오므로 차단한다 (PROD 경로에서만 쓰인다)
vi.mock('../../../lib/authFetch', () => ({
    getAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

type CoreModule = typeof import('../../../lib/tmap/core');

let core: CoreModule;
let fetchMock: ReturnType<typeof vi.fn>;

async function loadCore(apiKey = 'test-key'): Promise<CoreModule> {
    vi.stubEnv('VITE_TMAP_API_KEY', apiKey);
    vi.resetModules();
    return import('../../../lib/tmap/core');
}

/** fetch 응답 스텁 */
function jsonResponse(body: unknown, status = 200) {
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}
function rawResponse(text: string, status = 200) {
    return { ok: status >= 200 && status < 300, status, text: async () => text };
}

beforeEach(async () => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    core = await loadCore();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
});

describe('쿨다운 규칙', () => {
    it('초기 상태는 쿨다운이 아니다', () => {
        expect(core.isTmapCoolingDown()).toBe(false);
    });

    it('일반 실패 2회까지는 쿨다운에 들어가지 않는다', () => {
        core.recordFail();
        core.recordFail();
        expect(core.isTmapCoolingDown()).toBe(false);
    });

    it('일반 실패 3회 연속이면 쿨다운에 들어간다', () => {
        core.recordFail();
        core.recordFail();
        core.recordFail();
        expect(core.isTmapCoolingDown()).toBe(true);
    });

    it('성공하면 실패 카운터가 리셋되어 다시 3회를 채워야 한다', () => {
        core.recordFail();
        core.recordFail();
        core.recordSuccess();
        core.recordFail();
        core.recordFail();
        expect(core.isTmapCoolingDown()).toBe(false);

        core.recordFail();
        expect(core.isTmapCoolingDown()).toBe(true);
    });

    it('429는 단 1회로 즉시 쿨다운에 들어간다 (재시도 폭주 방지)', () => {
        core.recordFail(true);
        expect(core.isTmapCoolingDown()).toBe(true);
    });

    it('429 쿨다운은 30초 뒤 해제된다', () => {
        vi.useFakeTimers();
        core.recordFail(true);
        expect(core.isTmapCoolingDown()).toBe(true);

        vi.advanceTimersByTime(30_000);
        expect(core.isTmapCoolingDown()).toBe(false);
    });

    it('연속 실패 쿨다운은 5분 뒤 해제된다', () => {
        vi.useFakeTimers();
        core.recordFail();
        core.recordFail();
        core.recordFail();
        expect(core.isTmapCoolingDown()).toBe(true);

        vi.advanceTimersByTime(5 * 60_000 - 1);
        expect(core.isTmapCoolingDown()).toBe(true);
        vi.advanceTimersByTime(1);
        expect(core.isTmapCoolingDown()).toBe(false);
    });

    it('429 쿨다운은 더 긴 기존 쿨다운을 앞당기지 않는다', () => {
        vi.useFakeTimers();
        core.recordFail();
        core.recordFail();
        core.recordFail(); // 5분 쿨다운
        core.recordFail(true); // 30초 — 기존 5분을 줄이면 안 된다

        vi.advanceTimersByTime(31_000);
        expect(core.isTmapCoolingDown()).toBe(true);
    });
});

describe('isTmapAvailable', () => {
    it('개발 환경에서 API 키가 있으면 사용 가능', () => {
        expect(core.isTmapAvailable()).toBe(true);
    });

    it('개발 환경에서 API 키가 없으면 사용 불가', async () => {
        const noKey = await loadCore('');
        expect(noKey.isTmapAvailable()).toBe(false);
    });
});

describe('VEHICLE_TYPE_TO_CAR_TYPE', () => {
    // carType은 통행료 계산에 직접 들어간다 — 경차(6)는 톨비 50% 할인이라 값이 틀리면 비용이 틀린다
    it('차종별 T-Map carType 매핑을 고정한다', () => {
        expect(core.VEHICLE_TYPE_TO_CAR_TYPE).toEqual({
            compact: '6',
            sedan: '1',
            van: '2',
            bus: '3',
            truck: '1',
        });
    });
});

describe('parseDestinations', () => {
    it('쉼표로 나누고 공백·빈 항목을 제거한다', () => {
        expect(core.parseDestinations(' 서울시청 , , 강남역 ,')).toEqual(['서울시청', '강남역']);
    });

    it('최대 5곳으로 제한한다', () => {
        expect(core.parseDestinations('A,B,C,D,E,F,G')).toEqual(['A', 'B', 'C', 'D', 'E']);
        expect(core.MAX_DESTINATIONS).toBe(5);
    });

    it('빈 입력은 빈 배열', () => {
        expect(core.parseDestinations('')).toEqual([]);
        expect(core.parseDestinations('   ')).toEqual([]);
        expect(core.parseDestinations(null as unknown as string)).toEqual([]);
    });
});

describe('캐시 영속화', () => {
    it('geoCache에 넣으면 localStorage에 기록된다', () => {
        core.geoCache.set('서울시청', { lat: 37.5, lon: 127.0, name: '서울시청' });

        const raw = localStorage.getItem('tmap_geo_cache_v1');
        expect(raw).not.toBeNull();
        expect(JSON.parse(raw!)).toEqual([['서울시청', { lat: 37.5, lon: 127.0, name: '서울시청' }]]);
    });

    it('routeCache에 넣으면 localStorage에 기록된다', () => {
        core.routeCache.set('k', { distance: 10, duration: 20, tollFee: 0, fuelCost: 0 });

        expect(JSON.parse(localStorage.getItem('tmap_route_cache_v1')!))
            .toEqual([['k', { distance: 10, duration: 20, tollFee: 0, fuelCost: 0 }]]);
    });

    it('다음 로드 때 localStorage에서 캐시를 복원한다', async () => {
        core.geoCache.set('강남역', { lat: 37.49, lon: 127.02, name: '강남역' });

        const reloaded = await loadCore();
        expect(reloaded.geoCache.get('강남역')).toEqual({ lat: 37.49, lon: 127.02, name: '강남역' });
    });

    it('저장된 캐시가 깨져 있어도 빈 캐시로 시작한다', async () => {
        localStorage.setItem('tmap_geo_cache_v1', '{not json');

        const reloaded = await loadCore();
        expect(reloaded.geoCache.size).toBe(0);
    });

    it('조회 실패(null)도 캐시해 재조회를 막는다', () => {
        core.geoCache.set('없는주소', null);

        expect(core.geoCache.has('없는주소')).toBe(true);
        expect(core.geoCache.get('없는주소')).toBeNull();
    });
});

describe('enqueue — 글로벌 요청 큐', () => {
    it('결과를 그대로 돌려준다', async () => {
        await expect(core.enqueue(async () => 42)).resolves.toBe(42);
    });

    it('쿨다운 중에는 작업을 실행하지 않고 null을 반환한다', async () => {
        core.recordFail(true);
        const fn = vi.fn(async () => 'x');

        await expect(core.enqueue(fn)).resolves.toBeNull();
        expect(fn).not.toHaveBeenCalled();
    });

    it('작업이 던진 예외를 호출자에게 전달한다', async () => {
        await expect(core.enqueue(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    });

    it('요청 사이에 최소 간격을 두고 순차 실행한다', async () => {
        vi.useFakeTimers();
        const order: string[] = [];

        const p1 = core.enqueue(async () => { order.push('1'); return 1; });
        const p2 = core.enqueue(async () => { order.push('2'); return 2; });

        await vi.advanceTimersByTimeAsync(0);
        expect(order).toEqual(['1']); // 간격이 지나기 전에는 두 번째가 시작되지 않는다

        await vi.advanceTimersByTimeAsync(1200);
        await expect(Promise.all([p1, p2])).resolves.toEqual([1, 2]);
        expect(order).toEqual(['1', '2']);
    });

    it('앞선 작업이 실패해도 큐가 멈추지 않는다', async () => {
        vi.useFakeTimers();
        const failed = core.enqueue(async () => { throw new Error('첫 요청 실패'); });
        const next = core.enqueue(async () => 'ok');

        await expect(failed).rejects.toThrow('첫 요청 실패');
        await vi.advanceTimersByTimeAsync(1200);
        await expect(next).resolves.toBe('ok');
    });
});

describe('fetchTmap', () => {
    it('쿨다운 중이면 네트워크를 건드리지 않고 null을 반환한다', async () => {
        core.recordFail(true);

        await expect(core.fetchTmap('/prod', '/dev')).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('개발 환경에서는 devUrl과 appKey 헤더를 쓴다', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

        await core.fetchTmap('/prod', '/dev');

        expect(fetchMock).toHaveBeenCalledWith('/dev', expect.objectContaining({
            method: 'GET',
            headers: { appKey: 'test-key' },
        }));
    });

    it('POST 본문을 주면 JSON으로 직렬화하고 Content-Type을 붙인다', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

        await core.fetchTmap('/prod', '/dev', 'POST', { startX: '127' });

        const [, init] = fetchMock.mock.calls[0];
        expect(init.method).toBe('POST');
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(init.body).toBe(JSON.stringify({ startX: '127' }));
    });

    it('성공 응답을 파싱해 반환한다', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ features: [{ id: 1 }] }));

        await expect(core.fetchTmap('/prod', '/dev')).resolves.toEqual({ features: [{ id: 1 }] });
    });

    it('성공하면 실패 카운터를 리셋한다', async () => {
        core.recordFail();
        core.recordFail();
        fetchMock.mockResolvedValue(jsonResponse({}));

        await core.fetchTmap('/prod', '/dev');

        core.recordFail();
        core.recordFail();
        expect(core.isTmapCoolingDown()).toBe(false); // 리셋되지 않았다면 여기서 쿨다운
    });

    it('429는 예외 대신 null을 반환하고 즉시 쿨다운시킨다', async () => {
        fetchMock.mockResolvedValue(rawResponse('', 429));

        await expect(core.fetchTmap('/prod', '/dev')).resolves.toBeNull();
        expect(core.isTmapCoolingDown()).toBe(true);
    });

    it('429 외의 HTTP 에러는 예외로 올린다', async () => {
        fetchMock.mockResolvedValue(rawResponse('', 500));

        await expect(core.fetchTmap('/prod', '/dev')).rejects.toThrow('T-Map API HTTP Error: 500');
    });

    it('본문이 비어 있으면 null을 반환한다 (204 등)', async () => {
        fetchMock.mockResolvedValue(rawResponse(''));

        await expect(core.fetchTmap('/prod', '/dev')).resolves.toBeNull();
    });

    it('JSON이 아닌 본문이면 파싱 예외 대신 null을 반환한다', async () => {
        fetchMock.mockResolvedValue(rawResponse('<html>error page</html>'));

        await expect(core.fetchTmap('/prod', '/dev')).resolves.toBeNull();
    });
});
