/* eslint-disable no-undef */
// Firebase Cloud Messaging 백그라운드 메시지 수신용 Service Worker
// 참고: compat CDN은 서비스 워커 호환이 검증된 11.x를 사용
// 주의: 이 파일은 템플릿입니다. 직접 수정하지 마세요.
//       빌드 시 scripts/generate-sw-config.js가 .env 값을 주입합니다.
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: 'AIzaSyCLPU3D7VmLob-MrpVfvjAqavRU8t0gg1E',
    authDomain: 'vehicle-drive-log.web.app',
    projectId: 'vehicle-drive-log',
    storageBucket: 'vehicle-drive-log.firebasestorage.app',
    messagingSenderId: '1066541065552',
    appId: '1:1066541065552:web:684a45d37a44c7a7dd7855',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    // notification 필드가 있으면 FCM SDK가 자동 표시하므로 수동 표시 불필요
    if (payload.notification) return;

    // data-only 메시지인 경우에만 수동 표시
    const { title, body, icon } = payload.data || {};
    self.registration.showNotification(title || '차량운행일지', {
        body: body || '새로운 알림이 있습니다.',
        icon: icon || '/icons/icon-512.png',
        badge: '/icons/icon-192.png',
        tag: 'vehicle-drive-log',
    });
});
