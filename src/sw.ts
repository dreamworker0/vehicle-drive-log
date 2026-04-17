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
import * as navigationPreload from 'workbox-navigation-preload';

// Navigation Preload 활성화 (초기 로딩 속도 최적화)
navigationPreload.enable();

// 1. 기존 캐시 정리 및 정적 파일 프리캐싱
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

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

// 4. Background Sync 이벤트 리스너 등록
self.addEventListener('sync', (event: ExtendableEvent & { tag: string }) => {
    if (event.tag === 'sync-offline-actions') {
        console.log('[SW] Background Sync 이벤트 수신: sync-offline-actions');
        event.waitUntil(processBackgroundSync());
    }
});

// 백그라운드 동기화 처리 로직
async function processBackgroundSync() {
    // 1. 현재 열려있는 창(클라이언트 앱)이 있는지 확인합니다.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    
    if (clients && clients.length > 0) {
        // 창이 활성화되어 있으면 무거운 처리를 메인 스레드로 넘깁니다. (UI 반영 및 배터리 세이브)
        console.log('[SW] 활성 클라이언트 감지, FLUSH_OFFLINE_QUEUE 메시지 전송');
        clients[0].postMessage({ type: 'FLUSH_OFFLINE_QUEUE' });
        return;
    }

    // 2. 창이 모두 닫힌 상태라면 다음 클라이언트 활성화 시 처리하도록 재시도를 예약합니다.
    // offlineSyncProcessor를 import하면 Firebase Auth SDK가 함께 로드되어
    // window.localStorage를 비동기 polling으로 참조하게 되고, 이는 Service Worker 환경에서
    // catch할 수 없는 unhandled rejection을 발생시킵니다.
    // 따라서 SW에서는 직접 큐 처리를 시도하지 않고, 에러를 던져 브라우저가 다음에 재시도하도록 합니다.
    console.log('[SW] 활성 클라이언트 없음 — 다음 클라이언트 활성화 시 큐 처리 예정 (Background Sync 재시도 예약)');
    throw new Error('NO_ACTIVE_CLIENT');
}

// 5. 업데이트 시 새 워커 활성화 메세지 처리
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// 6. 알림 클릭 이벤트 처리 (Notification Click)
self.addEventListener('notificationclick', (event: NotificationEvent) => {
    event.notification.close();
    
    // 알림을 발생시킬 때 data에 넣은 click_action URL 가져오기
    const urlToOpen = event.notification.data?.click_action || '/';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // 이미 열려있는 창이 있다면 포커스하고 URL을 이동
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url && 'focus' in client) {
                    if (client.url !== urlToOpen && 'navigate' in client) {
                        client.navigate(urlToOpen);
                    }
                    return client.focus();
                }
            }
            // 열려있는 창이 없으면 새 창 열기
            if (self.clients.openWindow) {
                return self.clients.openWindow(urlToOpen);
            }
        })
    );
});
