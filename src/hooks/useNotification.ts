import { useState, useEffect, useCallback, useRef } from 'react';
import { getToken, onMessage } from 'firebase/messaging';
import { getMessagingInstance } from '../lib/firebase';
import { updateUser } from '../lib/firestore';
import { useAuth } from './useAuth';
import { useToast } from './useToast';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

// iOS Safari 등 Notification API가 없는 환경에서 안전하게 접근하기 위한 헬퍼
function getNotificationAPI() {
    try {
        return typeof window !== 'undefined' && 'Notification' in window
            ? window.Notification
            : null;
    } catch {
        return null;
    }
}

export default function useNotification() {
    const { user, userData } = useAuth();
    const { showToast } = useToast();
    // 저장된 토큰은 ref로 본다 — effect 의존성에 넣으면 토큰을 쓸 때마다 effect가 다시 돈다
    // (아래 자동 갱신 effect보다 먼저 선언해 같은 커밋에서 먼저 반영되게 한다)
    const storedFcmToken = userData?.fcmToken;
    const storedFcmTokenRef = useRef(storedFcmToken);
    useEffect(() => {
        storedFcmTokenRef.current = storedFcmToken;
    }, [storedFcmToken]);
    const userDataLoaded = userData != null;
    const NotificationAPI = getNotificationAPI();
    const [permission, setPermission] = useState(
        NotificationAPI ? NotificationAPI.permission : 'denied'
    );
    const [token, setToken] = useState<string | null>(null);
    const [isSupported, setIsSupported] = useState(false);

    // FCM 토큰 요청
    const requestPermission = useCallback(async () => {
        const Notif = getNotificationAPI();
        if (!Notif) {
            showToast('이 브라우저에서는 푸시 알림을 지원하지 않습니다.', 'warning');
            return null;
        }
        const messaging = await getMessagingInstance();
        if (!messaging || !VAPID_KEY) {
            showToast('푸시 알림이 지원되지 않는 환경입니다.', 'warning');
            return null;
        }

        try {
            const status = await Notif.requestPermission();
            setPermission(status);

            if (status !== 'granted') {
                showToast('알림 권한이 거부되었습니다.', 'warning');
                return null;
            }

            const fcmToken = await getToken(messaging, { vapidKey: VAPID_KEY });
            setToken(fcmToken);

            // Firestore에 토큰 저장
            if (user?.uid) {
                await updateUser(user.uid, { fcmToken });
            }

            showToast('알림이 활성화되었습니다.', 'success');
            return fcmToken;
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            if (errorMessage.includes('failed-service-worker-registration')) {
                console.warn('FCM 토큰 요청 실패: 서비스워커 등록 타임아웃 (브라우저 환경 제약)');
                showToast('이 브라우저 환경에서는 푸시 알림 설정이 지연되거나 지원되지 않을 수 있습니다.', 'warning');
            } else {
                console.error('FCM 토큰 요청 실패:', err);
                showToast('알림 설정 중 오류가 발생했습니다.', 'error');
            }
            return null;
        }
    }, [user, showToast]);

    // 앱 로드 시 FCM 토큰 자동 갱신 (권한이 이미 granted인 경우)
    //
    // 저장된 토큰과 같으면 쓰지 않는다. users 문서를 쓸 때마다 트리거 3개(감사 로그·커스텀 클레임·
    // 권한 변경 알림)가 깨어나는데, 토큰은 거의 바뀌지 않아 앱을 열 때마다 헛돌았다
    // (2026-10 실측: 각 1.47만 회/월, Cloud Run vCPU 사용량의 약 7%). 비교하려면 users 문서가
    // 로드돼 있어야 하므로 그 전에는 기다린다.
    useEffect(() => {
        if (!user?.uid || !userDataLoaded) return;
        const Notif = getNotificationAPI();
        if (!Notif || Notif.permission !== 'granted') return;

        (async () => {
            try {
                const messaging = await getMessagingInstance();
                if (!messaging || !VAPID_KEY) return;
                const fcmToken = await getToken(messaging, { vapidKey: VAPID_KEY });
                if (fcmToken) {
                    setToken(fcmToken);
                    if (fcmToken !== storedFcmTokenRef.current) {
                        await updateUser(user.uid, { fcmToken });
                    }
                }
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                if (errorMessage.includes('failed-service-worker-registration')) {
                    console.warn('FCM 토큰 자동 갱신 실패: 서비스워커 등록 타임아웃');
                } else {
                    console.error('FCM 토큰 자동 갱신 실패:', err);
                }
            }
        })();
    }, [user, userDataLoaded]);

    // 포그라운드 메시지 수신
    useEffect(() => {
        let unsubscribe: (() => void) | undefined;
        (async () => {
            const messaging = await getMessagingInstance();
            if (!messaging) return;
            setIsSupported(true);
            unsubscribe = onMessage(messaging, (payload) => {
                // 서버는 data-only로 보내므로 제목·본문은 data에 있다.
                // payload.notification은 구버전 서버가 보낸 메시지를 위한 폴백이다.
                const title = payload.notification?.title ?? payload.data?.title;
                const body = payload.notification?.body ?? payload.data?.body;
                if (title) {
                    // body가 없을 때 "제목: undefined"가 뜨지 않게 한다
                    showToast(body ? `${title}: ${body}` : title, 'info');
                }
            });
        })();
        return () => unsubscribe?.();
    }, [showToast]);

    return {
        permission,
        token,
        requestPermission,
        isSupported,
    };
}
