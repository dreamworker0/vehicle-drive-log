/**
 * tmap/deeplink.test.ts — 내비게이션 앱 딥링크 생성 테스트
 *
 * URL 스킴이 틀리면 앱이 열리지 않거나 엉뚱한 목적지로 안내한다.
 * 앱별 파라미터 이름(goalx/dlng/ep)과 경유지 표기 규칙을 고정한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { settle } from './tmapHarness';

vi.mock('../../../lib/authFetch', () => ({
    getAuthHeaders: vi.fn(async () => ({})),
}));

let deeplink: typeof import('../../../lib/tmap/deeplink');
let core: typeof import('../../../lib/tmap/core');
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
    localStorage.clear();
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('VITE_TMAP_API_KEY', 'test-key');
    vi.resetModules();
    core = await import('../../../lib/tmap/core');
    deeplink = await import('../../../lib/tmap/deeplink');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
});

function seedCoords(map: Record<string, [number, number] | null>) {
    for (const [addr, coord] of Object.entries(map)) {
        core.geoCache.set(addr, coord ? { lat: coord[0], lon: coord[1], name: addr } : null);
    }
}

const TMAP_FALLBACK = 'tmap://open';
const NAVER_FALLBACK = 'nmap://actionPath?appname=vehicle-log';
const KAKAO_FALLBACK = 'kakaomap://open';

describe('getNavigationDeeplink — 앱 선택', () => {
    it('알 수 없는 앱 이름은 T-Map으로 처리한다', async () => {
        seedCoords({ '시청': [37.5, 127.0] });

        await expect(settle(deeplink.getNavigationDeeplink('unknown-app', '시청')))
            .resolves.toContain('tmap://route?');
    });

    it('앱별로 서로 다른 스킴을 만든다', async () => {
        seedCoords({ '시청': [37.5, 127.0] });

        const tmap = await settle(deeplink.getNavigationDeeplink('tmap', '시청'));
        const naver = await settle(deeplink.getNavigationDeeplink('naver', '시청'));
        const kakao = await settle(deeplink.getNavigationDeeplink('kakao', '시청'));

        expect(tmap.startsWith('tmap://')).toBe(true);
        expect(naver.startsWith('nmap://')).toBe(true);
        expect(kakao.startsWith('kakaomap://')).toBe(true);
    });
});

describe('T-Map 딥링크', () => {
    it('목적지 좌표를 goalx/goaly로 넘긴다', async () => {
        seedCoords({ '서울시청': [37.5663, 126.9779] });

        const url = await settle(deeplink.getNavigationDeeplink('tmap', '서울시청'));

        expect(url).toBe(`tmap://route?goalname=${encodeURIComponent('서울시청')}&goalx=126.9779&goaly=37.5663`);
    });

    it('좌표를 못 찾으면 목적지 이름만 넘긴다', async () => {
        seedCoords({ '없는곳': null });

        await expect(settle(deeplink.getNavigationDeeplink('tmap', '없는곳')))
            .resolves.toBe(`tmap://route?goalname=${encodeURIComponent('없는곳')}`);
    });

    it('목적지가 여러 곳이면 첫 번째만 사용한다 (T-Map은 경유지 미지원)', async () => {
        seedCoords({ '시청': [37.5, 127.0], '병원': [37.6, 127.1] });

        const url = await settle(deeplink.getNavigationDeeplink('tmap', '시청, 병원'));

        expect(url).toContain(encodeURIComponent('시청'));
        expect(url).not.toContain(encodeURIComponent('병원'));
    });

    it('목적지가 비면 앱만 연다', async () => {
        await expect(deeplink.getNavigationDeeplink('tmap', '')).resolves.toBe(TMAP_FALLBACK);
        await expect(deeplink.getNavigationDeeplink('tmap', ' , , ')).resolves.toBe(TMAP_FALLBACK);
    });

    it('목적지 이름을 URL 인코딩한다', async () => {
        seedCoords({ '서울 시청 & 광장': [37.5, 127.0] });

        const url = await settle(deeplink.getNavigationDeeplink('tmap', '서울 시청 & 광장'));

        expect(url).toContain(encodeURIComponent('서울 시청 & 광장'));
        expect(url).not.toContain(' ');
    });
});

describe('네이버 지도 딥링크', () => {
    it('마지막 목적지를 도착지(dlat/dlng)로 넘긴다', async () => {
        seedCoords({ '시청': [37.5, 127.0], '병원': [37.6, 127.1] });

        const url = await settle(deeplink.getNavigationDeeplink('naver', '시청, 병원'));

        expect(url).toContain('dlat=37.6');
        expect(url).toContain('dlng=127.1');
        expect(url).toContain(`dname=${encodeURIComponent('병원')}`);
        expect(url).toContain('appname=vehicle-log');
    });

    it('앞의 목적지들은 경유지(v1/v2)로 붙인다', async () => {
        seedCoords({ '시청': [37.5, 127.0], '병원': [37.6, 127.1], '학교': [37.7, 127.2] });

        const url = await settle(deeplink.getNavigationDeeplink('naver', '시청, 병원, 학교'));

        expect(url).toContain(`v1lat=37.5&v1lng=127&v1name=${encodeURIComponent('시청')}`);
        expect(url).toContain(`v2lat=37.6&v2lng=127.1&v2name=${encodeURIComponent('병원')}`);
        expect(url).toContain('dlat=37.7'); // 마지막은 도착지
    });

    it('단일 목적지면 경유지를 붙이지 않는다', async () => {
        seedCoords({ '시청': [37.5, 127.0] });

        const url = await settle(deeplink.getNavigationDeeplink('naver', '시청'));

        expect(url).toContain('dlat=37.5');
        expect(url).not.toContain('v1lat');
    });

    it('좌표를 못 찾은 경유지는 건너뛰고 나머지는 유지한다', async () => {
        seedCoords({ '시청': null, '병원': [37.6, 127.1], '학교': [37.7, 127.2] });

        const url = await settle(deeplink.getNavigationDeeplink('naver', '시청, 병원, 학교'));

        expect(url).not.toContain('v1lat');
        expect(url).toContain(`v2lat=37.6&v2lng=127.1&v2name=${encodeURIComponent('병원')}`);
        expect(url).toContain('dlat=37.7');
    });

    it('도착지 좌표를 못 찾으면 앱만 연다', async () => {
        seedCoords({ '시청': [37.5, 127.0], '없는곳': null });

        await expect(settle(deeplink.getNavigationDeeplink('naver', '시청, 없는곳')))
            .resolves.toBe(NAVER_FALLBACK);
    });

    it('목적지가 비면 앱만 연다', async () => {
        await expect(deeplink.getNavigationDeeplink('naver', '')).resolves.toBe(NAVER_FALLBACK);
        await expect(deeplink.getNavigationDeeplink('naver', ' , ')).resolves.toBe(NAVER_FALLBACK);
    });
});

describe('카카오맵 딥링크', () => {
    it('마지막 목적지를 ep(위도,경도)로 넘기고 자동차 모드를 지정한다', async () => {
        seedCoords({ '시청': [37.5, 127.0], '병원': [37.6, 127.1] });

        const url = await settle(deeplink.getNavigationDeeplink('kakao', '시청, 병원'));

        expect(url).toContain('ep=37.6,127.1');
        expect(url).toContain('by=CAR');
    });

    it('앞의 목적지들은 경유지(wp1/wp2)로 붙인다', async () => {
        seedCoords({ '시청': [37.5, 127.0], '병원': [37.6, 127.1], '학교': [37.7, 127.2] });

        const url = await settle(deeplink.getNavigationDeeplink('kakao', '시청, 병원, 학교'));

        expect(url).toContain('wp1=37.5,127');
        expect(url).toContain('wp2=37.6,127.1');
        expect(url).toContain('ep=37.7,127.2');
    });

    it('단일 목적지면 경유지를 붙이지 않는다', async () => {
        seedCoords({ '시청': [37.5, 127.0] });

        const url = await settle(deeplink.getNavigationDeeplink('kakao', '시청'));

        expect(url).toBe('kakaomap://route?ep=37.5,127&by=CAR');
    });

    it('도착지 좌표를 못 찾으면 앱만 연다', async () => {
        seedCoords({ '없는곳': null });

        await expect(settle(deeplink.getNavigationDeeplink('kakao', '없는곳')))
            .resolves.toBe(KAKAO_FALLBACK);
    });

    it('목적지가 비면 앱만 연다', async () => {
        await expect(deeplink.getNavigationDeeplink('kakao', '')).resolves.toBe(KAKAO_FALLBACK);
        await expect(deeplink.getNavigationDeeplink('kakao', ',,')).resolves.toBe(KAKAO_FALLBACK);
    });
});
