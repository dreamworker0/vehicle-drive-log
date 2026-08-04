/* eslint-disable no-undef */
// Firebase Cloud Messaging 백그라운드 메시지 수신용 Service Worker
// 참고: compat CDN은 서비스 워커 호환이 검증된 11.x를 사용
// 주의: 이 파일은 템플릿입니다. 직접 수정하지 마세요.
//       빌드 시 scripts/generate-sw-config.js가 .env 값을 주입합니다.
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: '__FIREBASE_API_KEY__',
    authDomain: '__FIREBASE_AUTH_DOMAIN__',
    projectId: '__FIREBASE_PROJECT_ID__',
    storageBucket: '__FIREBASE_STORAGE_BUCKET__',
    messagingSenderId: '__FIREBASE_MESSAGING_SENDER_ID__',
    appId: '__FIREBASE_APP_ID__',
});

const messaging = firebase.messaging();

// 서버는 data-only로 보낸다(functions/src/services/alimtalk/sendNotification.ts).
// notification 필드가 실린 메시지는 FCM SDK가 자동 표시하고 클릭까지 SDK 기본 핸들러가
// 가져가므로 아래 '대상 탭 선정'이 적용되지 않는다 — 구버전 서버가 보낸 메시지가 남아 있을
// 수 있어 그 경로는 그대로 SDK에 맡긴다(알림이 아예 안 뜨는 것보다 낫다).
messaging.onBackgroundMessage((payload) => {
    if (payload.notification) return;

    const data = payload.data || {};
    const options = {
        body: data.body || '새로운 알림이 있습니다.',
        icon: data.icon || '/icons/icon-512.png',
        badge: '/icons/icon-192.png',
        // 서버가 webpush.notification으로 넘기던 옵션을 여기로 옮겼다
        requireInteraction: true,
        vibrate: [200, 100, 200],
        // 클릭 대상을 알림에 실어 둔다 — 이게 없으면 클릭해도 갈 곳을 모른다
        data: { click_action: data.click_action || '/' },
    };
    // tag를 고정하면 **나중 알림이 앞 알림을 덮어써** 하나만 남는다. 예약 알림 세 건이
    // 연달아 와도 마지막 것만 보이게 되므로, 서버가 묶으라고 지정한 경우에만 tag를 쓴다.
    // (기존 프로덕션 경로는 FCM SDK 자동 표시라 tag가 없었다 — 그 동작을 유지한다.)
    if (data.tag) options.tag = data.tag;

    // showNotification의 Promise를 돌려줘야 push 이벤트가 표시 완료까지 살아 있는다.
    // 놓치면 표시 전에 워커가 종료돼 브라우저가 "백그라운드에서 업데이트됨" 같은
    // 대체 알림을 띄울 수 있다.
    return self.registration.showNotification(data.title || '차량운행일지', options);
});

// ## 알림 클릭 — 보고 있는 탭에서 열고, 다른 탭은 건드리지 않는다
//
// 규칙은 src/sw.ts의 openNotificationTarget과 같다. 두 워커가 각자 표시한 알림은 각자에게
// 클릭 이벤트가 오므로(알림은 그것을 띄운 registration에 속한다) 로직이 양쪽에 필요하다.
// 이 파일은 번들되지 않는 순수 JS 템플릿이라 sw.ts에서 import할 수 없다 — 규칙을 고칠 때는
// **두 곳을 함께** 고쳐야 한다.
//
// 결정적인 차이: 이 워커의 scope는 `/firebase-cloud-messaging-push-scope`라서 **앱 탭을
// 제어하지 않는다.** 제어하지 않는 클라이언트에는 navigate()가 거부되므로(spec: TypeError)
// 이동을 직접 하지 못한다. 대신 postMessage로 앱에 맡긴다(src/App.tsx의 NOTIFICATION_CLICK
// 수신부가 same-origin을 확인한 뒤 이동한다).
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const raw = event.notification.data && event.notification.data.click_action;
    let target;
    try {
        target = new URL(raw || '/', self.location.origin);
    } catch {
        target = new URL('/', self.location.origin);
    }
    // 알림 payload는 서버가 만들지만 외부 origin으로 끌고 가지 않도록 방어한다
    if (target.origin !== self.location.origin) {
        target = new URL('/', self.location.origin);
    }

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            // ① 이미 그 페이지를 띄운 탭이 있으면 포커스만 (재로딩 없음 → 입력 중이던 내용 보존)
            const onTarget = clients.find((client) => client.url === target.href);
            if (onTarget) return onTarget.focus();

            // ② 지금 보고 있는 탭 → ③ 없으면 마지막으로 쓴 탭(matchAll은 최근 포커스 순)
            const reusable =
                clients.find((client) => client.focused) ||
                clients.find((client) => client.visibilityState === 'visible') ||
                clients[0];

            if (reusable) {
                reusable.postMessage({ type: 'NOTIFICATION_CLICK', url: target.href });
                return reusable.focus();
            }

            // 열려있는 창이 없으면 새 창 열기
            if (self.clients.openWindow) {
                return self.clients.openWindow(target.href);
            }
        })
    );
});
