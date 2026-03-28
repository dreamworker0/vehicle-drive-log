/// <reference lib="webworker" />
declare let self: ServiceWorkerGlobalScope;

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

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

// 4. Background Sync 이벤트 리스너 등록
self.addEventListener('sync', (event: any) => {
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

    // 2. 창이 모두 닫힌 상태라면 직접 백그라운드에서 실행합니다.
    console.log('[SW] 활성 클라이언트 없음 - 백그라운드에서 직접 큐 처리 시도');
    try {
        // 기존 offlineSyncProcessor의 전송 로직을 동적으로 불러옵니다.
        // Worker 컨텍스트에서 Firestore를 사용할 때 번들 용량을 최적화하기 위함입니다.
        const { processOfflineQueue } = await import('./lib/offlineSyncProcessor');
        await processOfflineQueue();
        console.log('[SW] 백그라운드 오프라인 큐 처리 완료');
    } catch (err) {
        console.error('[SW] 백그라운드 오프라인 큐 처리 실패:', err);
        // 에러를 던져야 브라우저가 다시 Background Sync를 스케줄링(재시도)합니다.
        throw err;
    }
}

// 5. 업데이트 시 새 워커 활성화 메세지 처리
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// 6. 알림 클릭 이벤트 처리 (Notification Click)
self.addEventListener('notificationclick', (event: any) => {
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
