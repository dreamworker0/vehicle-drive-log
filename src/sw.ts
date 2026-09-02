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

// 3. 런타임 캐싱 (Google Fonts, Firebase Storage)
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
