import { useState, useEffect, useCallback } from 'react';
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
    const { user } = useAuth();
    const { showToast } = useToast();
    const NotificationAPI = getNotificationAPI();
    const [permission, setPermission] = useState(
        NotificationAPI ? NotificationAPI.permission : 'denied'
    );
    const [token, setToken] = useState(null);
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
        } catch (err) {
            console.error('FCM 토큰 요청 실패:', err);
            showToast('알림 설정 중 오류가 발생했습니다.', 'error');
            return null;
        }
    }, [user, showToast]);

    // 앱 로드 시 FCM 토큰 자동 갱신 (권한이 이미 granted인 경우)
    useEffect(() => {
        if (!user?.uid) return;
        const Notif = getNotificationAPI();
        if (!Notif || Notif.permission !== 'granted') return;

        (async () => {
            try {
                const messaging = await getMessagingInstance();
                if (!messaging || !VAPID_KEY) return;
                const fcmToken = await getToken(messaging, { vapidKey: VAPID_KEY });
                if (fcmToken) {
                    setToken(fcmToken);
                    await updateUser(user.uid, { fcmToken });
                }
            } catch (err) {
                console.error('FCM 토큰 자동 갱신 실패:', err);
            }
        })();
    }, [user]);

    // 포그라운드 메시지 수신
    useEffect(() => {
        let unsubscribe;
        (async () => {
            const messaging = await getMessagingInstance();
            if (!messaging) return;
            setIsSupported(true);
            unsubscribe = onMessage(messaging, (payload) => {
                const { title, body } = payload.notification || {};
                if (title) {
                    showToast(`${title}: ${body}`, 'info');
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
