/// <reference lib="webworker" />
declare let self: ServiceWorkerGlobalScope;

interface SyncEvent extends ExtendableEvent {
    readonly lastChance: boolean;
    readonly tag: string;
}

declare global {
    interface ServiceWorkerGlobalScopeEventMap {
        sync: SyncEvent;
    }
}

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// 새 배포된 워커가 'waiting'에 멈추지 않고 즉시 활성화되도록 한다.
// 이게 없으면 사용자는 하드 리프레시(또는 앱 완전 종료) 없이는 옛 캐시 버전만 보게 되고,
// 재접속 시에도 계속 옛 버전으로 원복됐다. skipWaiting으로 새 워커가 바로 활성화되어
// 다음 접속/재실행에서 최신 버전이 적용된다.
// (clientsClaim은 첫 로드에서 현재 페이지 제어권을 즉시 가로채 autoUpdate 리로드를 유발 →
//  Playwright E2E에서 "execution context destroyed"로 깨지므로 쓰지 않는다.
//  현재 페이지 즉시 교체 대신 '다음 내비게이션에서 최신 반영' 방식을 택한다.)
self.skipWaiting();

// Navigation Preload 비활성화
// 이전 버전의 SW에서 활성화된 navigation preload가 브라우저에 남아있으면
// "preloadResponse settled before respondWith" 경고가 발생합니다.
// 명시적으로 disable하여 완전히 해제합니다.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            if (self.registration.navigationPreload) {
                await self.registration.navigationPreload.disable();
            }
        })()
    );
});

// 1. 기존 캐시 정리 및 정적 파일 프리캐싱
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// 2. 라우팅 폴백 설정 (Single Page App 지원)
// /__/auth/ 경로(Firebase Auth 리다이렉트 등)는 캐시에서 제외합니다.
try {
    const handler = createHandlerBoundToURL('/index.html');
    const navigationRoute = new NavigationRoute(handler, {
        denylist: [/^\/__\/auth\//],
    });
    registerRoute(navigationRoute);
} catch (e) {
    console.log('[SW] PWA 네비게이션 폴백 설정 에러 (개발 환경 등):', e);
}

// 3. 런타임 캐싱 (앱 청크, 폰트, Storage, 지도)

/*
 * 앱 청크(/assets/) — 프리캐시에서 뺀 나머지를 **방문 시점에** 담는다.
 *
 * vite.config.js의 프리캐시는 앱 셸만 담으므로(그 주석 참고), 라우트별 청크는 여기서
 * 캐시된다. 파일명에 콘텐츠 해시가 박혀 있어 내용이 바뀌면 URL도 바뀐다 — 즉 같은 URL이
 * 다른 내용을 가리키는 일이 없으므로 CacheFirst가 안전하다(재검증 왕복이 순수 낭비다).
 *
 * 프리캐시된 셸 URL은 위 `precacheAndRoute`가 **먼저** 등록되어 그쪽이 처리한다.
 * workbox는 등록 순서로 라우트를 고르므로 이 라우트는 셸을 가로채지 않는다.
 *
 * ⚠️ 배포 후 오프라인 공백: 새 배포가 활성화되면 프리캐시의 index.html은 갱신되지만
 * 그것이 참조하는 **새 해시의 청크는 아직 이 캐시에 없다.** 온라인으로 한 번 열면
 * 그 순간 채워지고, 운전자 경로는 `lib/warmDriverRoutes.ts`가 앱 진입 때 워밍해 메운다.
 * (이전 전량 프리캐시 방식도 새 워커 설치가 온라인을 전제했으므로 이 전제 자체는 같다.)
 */
// 판정은 `request.destination`이 아니라 **경로 확장자**로 한다. 모듈 스크립트의
// destination은 브라우저·버전에 따라 빈 문자열로 오는 경우가 있어(iOS Safari),
// 그걸 조건에 걸면 그 기기에서만 청크가 캐시되지 않아 오프라인이 조용히 깨진다.
registerRoute(
    ({ url }) =>
        url.origin === self.location.origin &&
        url.pathname.startsWith('/assets/') &&
        (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')),
    new CacheFirst({
        cacheName: 'app-chunks',
        /*
         * `Vary`를 무시한다. 캐시 조회는 기본적으로 응답의 `Vary`(호스팅은 `Accept-Encoding`을
         * 붙인다)에 걸린 요청 헤더까지 일치해야 히트한다. 청크를 담을 때와 오프라인에서 꺼낼 때의
         * `Accept-Encoding`이 조금이라도 다르면 **캐시에 있는데도 빗나가** 네트워크로 나가고,
         * 오프라인이면 그대로 실패한다 — 지하 주차장에서 화면이 안 열리는 그 증상이다.
         * 실제로 미리보기 서버에서 재현됐다(2026-09-09: cache.match 미스, import()는 히트).
         * 파일명에 콘텐츠 해시가 있어 URL 하나가 내용 하나를 가리키므로 `Vary`로 구분할 것이 없다.
         */
        matchOptions: { ignoreVary: true },
        plugins: [
            new ExpirationPlugin({
                // 청크 148개 중 한 사용자가 실제로 밟는 것은 소수다. 배포가 잦아(하루 10~20회)
                // 옛 해시가 쌓이므로 상한을 둔다 — 최근 항목이 남으므로 현재 배포분이 밀려나지 않는다.
                maxEntries: 120,
                /*
                 * **maxAgeSeconds를 두지 않는다.** 나이로 만료시키면 매일 쓰는 청크도 오프라인에서
                 * 열리지 않게 된다. `ExpirationPlugin`의 신선도 판정(`_isResponseDateFresh`)은
                 * 응답의 `Date` 헤더를 보는데 그 값은 캐시에 담긴 뒤 **다시 갱신되지 않는다** —
                 * 조회 때 갱신되는 것은 축출용 LRU 타임스탬프뿐이다. 그래서 URL이 오래 그대로인
                 * 청크(react-vendor 등)는 기한이 지나면 stale로 판정되어 CacheFirst가 네트워크로
                 * 나가고, 지하 주차장에서는 **캐시에 파일이 있는데도** 화면이 열리지 않는다.
                 * 파일명에 콘텐츠 해시가 있어 내용이 불변이므로 나이로 만료시킬 이유 자체가 없다.
                 * 용량은 maxEntries가 잡는다.
                 */
                purgeOnQuotaError: true,
            }),
        ],
    })
);

// Google Fonts 캐싱
registerRoute(
    /^https:\/\/fonts\.(?:gstatic|googleapis)\.com\/.*/i,
    new CacheFirst({
        cacheName: 'google-fonts',
        plugins: [
            new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
        ],
    })
);

// 자체 호스팅 폰트 캐싱 (프리캐시 대신 런타임 — vite.config.js의 globIgnores 참고)
// 실제로 쓰인 서브셋 조각만 담기므로 지하 주차장 등 오프라인에서도 같은 서체로 보인다.
// 경로에 버전이 박혀 있어 갱신 시 URL이 바뀌므로 CacheFirst로 둔다.
registerRoute(
    ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/fonts/'),
    new CacheFirst({
        cacheName: 'self-hosted-fonts',
        plugins: [
            new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
        ],
    })
);

// 정적 데이터 JSON(/data/*.json — 사용 설명서·업데이트 소식)
// 번들 크기를 줄이려고 코드에서 빼내 런타임 fetch로 바꿨는데, 프리캐시 glob에도 다른 런타임 라우트에도
// 걸리지 않아 오프라인에서는 설명서와 소식이 빈 화면이었다 — 현장에서 "어떻게 하지?"를 열어 보는
// 바로 그 순간이다 (2026-09-02). 갱신은 다음 온라인 방문에서 조용히 받는다.
registerRoute(
    ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/data/') && url.pathname.endsWith('.json'),
    new StaleWhileRevalidate({
        cacheName: 'static-data',
        plugins: [
            new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 }),
        ],
    })
);

// Firebase Storage 캐싱 (차량 사진, OCR 등)
registerRoute(
    /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
    new StaleWhileRevalidate({
        cacheName: 'firebase-storage',
        plugins: [
            new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 }),
        ],
    })
);

// 지도(Tile) 이미지 캐싱 제한 적용
// Leaflet 지도 조각 이미지가 디바이스 용량을 무한정 잡아먹지 않도록 제한합니다.
registerRoute(
    /^https:\/\/[a-c]\.tile\.openstreetmap\.org\/.*/i,
    new StaleWhileRevalidate({
        cacheName: 'map-tiles-cache',
        plugins: [
            new ExpirationPlugin({ 
                maxEntries: 200, 
                maxAgeSeconds: 60 * 60 * 24 * 15, // 15일 보관
                purgeOnQuotaError: true // 용량 부족시 우선 삭제
            }),
        ],
    })
);


// 5. 업데이트 시 새 워커 활성화 메세지 처리
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// 백그라운드 동기화 (Background Sync) 처리
import { flushQueue } from './lib/offline/syncQueue';

self.addEventListener('sync', (event: SyncEvent) => {
    if (event.tag === 'sync-db') {
        event.waitUntil(flushQueue());
    }
});

// 6. 알림 클릭 이벤트 처리 (Notification Click)
//
// ## 어느 탭을 움직일지가 핵심이다
// 이전 구현은 matchAll이 준 배열의 **첫 번째** 탭을 조건 없이 navigate + focus 했다.
// 탭을 두 개 이상 띄워두면 사용자가 보고 있지 않은 탭의 주소가 바뀌고 포커스까지
// 그쪽으로 튀어, 두 탭이 같은 페이지로 따라 움직이는 것처럼 보였다.
// 우선순위를 명시한다: ①이미 그 페이지인 탭 → ②지금 보고 있는 탭 → ③마지막으로 쓴 탭.
// ①에서 navigate를 걸지 않는 것도 의도다 — 전체 재로딩이 SPA 상태를 날린다.
async function openNotificationTarget(rawUrl: string) {
    // 상대 경로를 절대 URL로 정규화한다. 이전에는 click_action('/employee/today')과
    // client.url('https://.../employee/today')을 직접 비교해 **항상 불일치**했고,
    // 그래서 이미 그 페이지를 보고 있는 탭까지 매번 다시 로드됐다.
    let target: URL;
    try {
        target = new URL(rawUrl, self.location.origin);
    } catch {
        target = new URL('/', self.location.origin);
    }
    // 알림 payload는 서버가 만들지만, 외부 origin으로 끌고 가지 않도록 방어한다.
    if (target.origin !== self.location.origin) {
        target = new URL('/', self.location.origin);
    }

    const clients = (await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
    })) as readonly WindowClient[];

    // ① 이미 그 페이지를 띄운 탭이 있으면 포커스만 (재로딩 없음)
    const onTarget = clients.find((client) => client.url === target.href);
    if (onTarget) return onTarget.focus();

    // ② 사용자가 지금 보고 있는 탭에서 이동한다
    // ③ 보이는 탭이 없으면(브라우저가 백그라운드) 마지막으로 포커스했던 탭을 쓴다.
    //    matchAll은 window 클라이언트를 '최근 포커스 순'으로 주므로 clients[0]이 그 탭이다.
    const reusable =
        clients.find((client) => client.focused) ??
        clients.find((client) => client.visibilityState === 'visible') ??
        clients[0];

    if (reusable) {
        try {
            // navigate는 이 워커가 제어하지 않는 클라이언트(includeUncontrolled로 잡힌 탭)에
            // 대해 거부된다. 그때는 새 창으로 폴백한다 — 알림 클릭이 무반응이 되지 않게.
            const navigated = await reusable.navigate(target.href);
            return (navigated ?? reusable).focus();
        } catch {
            /* 아래 openWindow로 폴백 */
        }
    }

    // 열려있는 창이 없으면 새 창 열기
    if (self.clients.openWindow) {
        return self.clients.openWindow(target.href);
    }
}

self.addEventListener('notificationclick', (event: NotificationEvent) => {
    event.notification.close();

    // 알림을 발생시킬 때 data에 넣은 click_action URL 가져오기
    const urlToOpen = event.notification.data?.click_action || '/';

    event.waitUntil(openNotificationTarget(urlToOpen));
});
