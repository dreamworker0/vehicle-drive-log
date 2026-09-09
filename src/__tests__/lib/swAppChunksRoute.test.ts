/**
 * 앱 청크 런타임 캐시 — **되돌리기 쉬운 두 판단**을 고정한다.
 *
 * 프리캐시를 앱 셸로 좁힌 뒤(vite.config.js) 라우트 청크의 오프라인은 이 라우트에만 달려
 * 있다. 그런데 이 라우트의 옵션 두 개는 "왜 이렇게 뒀는지"를 모르면 정리 대상처럼 보이고,
 * 어느 쪽이 되돌아가도 **증상이 지하 주차장에서만 나타난다**. 그래서 테스트로 못박는다.
 *
 *  1. `matchOptions.ignoreVary` — 캐시 조회는 기본적으로 응답의 `Vary`(호스팅은
 *     `Accept-Encoding`을 붙인다)에 걸린 요청 헤더까지 맞아야 히트한다. 담을 때와 꺼낼 때가
 *     다르면 **캐시에 있는데도 빗나가** 네트워크로 나가고, 오프라인이면 그대로 실패한다.
 *  2. `maxAgeSeconds` **부재** — 나이로 만료시키면 매일 쓰는 청크도 기한이 지나면 stale로
 *     판정된다. `ExpirationPlugin`의 신선도 판정은 응답의 `Date` 헤더를 보고 그 값은 조회로
 *     갱신되지 않기 때문이다(갱신되는 것은 축출용 LRU 타임스탬프뿐이다). 파일명에 콘텐츠
 *     해시가 있어 내용이 불변이므로 나이로 만료시킬 이유가 없다.
 *
 * 판정자(match 함수)도 함께 고정한다 — `request.destination`으로 판정하면 그 값이 빈
 * 문자열로 오는 기기(iOS Safari)에서만 캐시가 비어 오프라인이 조용히 깨진다.
 */
import { vi, describe, it, expect, beforeAll } from 'vitest';

vi.mock('workbox-precaching', () => ({
    precacheAndRoute: vi.fn(),
    cleanupOutdatedCaches: vi.fn(),
    createHandlerBoundToURL: vi.fn(() => vi.fn()),
}));

/** registerRoute 호출을 순서대로 담아 둔다 — 등록 순서 자체가 계약의 일부다. */
const routes: Array<{ match: unknown; strategy: unknown }> = [];
vi.mock('workbox-routing', () => ({
    registerRoute: vi.fn((match: unknown, strategy: unknown) => { routes.push({ match, strategy }); }),
    NavigationRoute: class { },
}));

/** 전략 생성 옵션을 그대로 보존해 검사한다. */
vi.mock('workbox-strategies', () => ({
    CacheFirst: class {
        constructor(public options: Record<string, unknown>) { }
    },
    StaleWhileRevalidate: class {
        constructor(public options: Record<string, unknown>) { }
    },
}));
vi.mock('workbox-expiration', () => ({
    ExpirationPlugin: class {
        constructor(public options: Record<string, unknown>) { }
    },
}));
vi.mock('@/lib/offline/syncQueue', () => ({
    flushQueue: vi.fn(),
}));

type MatchFn = (arg: { url: URL; request?: Request }) => boolean;
interface StrategyLike {
    options: {
        cacheName?: string;
        matchOptions?: { ignoreVary?: boolean };
        plugins?: Array<{ options?: Record<string, unknown> }>;
    };
}

let appChunks: { match: MatchFn; strategy: StrategyLike };

beforeAll(async () => {
    const swGlobal = self as unknown as Record<string, unknown>;
    swGlobal.skipWaiting = vi.fn();
    swGlobal.registration = { navigationPreload: { disable: vi.fn() } };
    swGlobal.clients = { matchAll: vi.fn(), openWindow: vi.fn() };
    swGlobal.__WB_MANIFEST = [];

    await import('../../sw');

    const found = routes.find(
        r => (r.strategy as StrategyLike | undefined)?.options?.cacheName === 'app-chunks',
    );
    if (!found) throw new Error('app-chunks 라우트가 등록되지 않았습니다');
    appChunks = { match: found.match as MatchFn, strategy: found.strategy as StrategyLike };
});

/** 판정 함수에 넘길 인자 — URL만으로 판정해야 한다. */
function at(path: string) {
    return { url: new URL(path, self.location.origin) };
}

describe('앱 청크 런타임 캐시 라우트', () => {
    it('Vary를 무시한다 — 캐시에 있는데 빗나가면 오프라인이 깨진다', () => {
        expect(appChunks.strategy.options.matchOptions?.ignoreVary).toBe(true);
    });

    it('나이로 만료시키지 않는다 — 해시 URL은 내용이 불변이다', () => {
        const expiration = appChunks.strategy.options.plugins?.[0];
        expect(expiration?.options).toBeDefined();
        expect(expiration?.options).not.toHaveProperty('maxAgeSeconds');
        // 용량 상한은 남아 있어야 한다 — 옛 해시가 무한히 쌓이면 기기 저장소를 잠식한다.
        expect(expiration?.options?.maxEntries).toBeTypeOf('number');
    });

    it('/assets/의 js·css를 담고 그 밖은 담지 않는다', () => {
        expect(appChunks.match(at('/assets/DriveLogForm-abc123.js'))).toBe(true);
        expect(appChunks.match(at('/assets/index-abc123.css'))).toBe(true);

        // 프리캐시가 담는 셸 이외의 루트 파일·이미지는 이 라우트 대상이 아니다.
        expect(appChunks.match(at('/sw-purge.js'))).toBe(false);
        expect(appChunks.match(at('/assets/screenshot-mobile.webp'))).toBe(false);
        expect(appChunks.match(at('/index.html'))).toBe(false);
    });

    it('외부 출처는 담지 않는다', () => {
        expect(appChunks.match({ url: new URL('https://cdn.example.com/assets/x.js') })).toBe(false);
    });

    it('request.destination에 의존하지 않는다 — 빈 문자열로 오는 기기가 있다', () => {
        // destination이 없어도(구형 iOS Safari의 모듈 스크립트) 그대로 히트해야 한다.
        expect(appChunks.match({ url: new URL('/assets/MyRecords-x.js', self.location.origin) })).toBe(true);
    });

    it('프리캐시 라우트보다 뒤에 등록된다 — 셸을 가로채면 안 된다', () => {
        const index = routes.findIndex(
            r => (r.strategy as StrategyLike | undefined)?.options?.cacheName === 'app-chunks',
        );
        // precacheAndRoute는 registerRoute를 거치지 않지만(모킹됨), 내비게이션 폴백보다
        // 뒤에 있어야 SPA 폴백이 먼저 잡힌다.
        expect(index).toBeGreaterThan(0);
    });
});
