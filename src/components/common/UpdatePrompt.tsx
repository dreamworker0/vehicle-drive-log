import { useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';

/** SW 업데이트 체크 간격 (10분) */
const SW_CHECK_INTERVAL = 10 * 60 * 1000;

export default function UpdatePrompt() {
    useEffect(() => {
        let intervalId: number | NodeJS.Timeout | undefined;
        let registration: ServiceWorkerRegistration | undefined;

        const updateSW = registerSW({
            onNeedRefresh() {
                console.log('[PWA] 새 버전 감지 → 자동 업데이트 적용');
                updateSW(true);
            },
            onOfflineReady() {
                console.log('[PWA] 오프라인 사용 준비 완료');
            },
            onRegisteredSW(_swUrl, reg) {
                registration = reg;
                if (reg) {
                    // 10분마다 주기적 업데이트 체크
                    intervalId = setInterval(() => {
                        reg.update();
                    }, SW_CHECK_INTERVAL);
                }
            },
        });

        // 탭 복귀(visibility change) 시 즉시 SW 업데이트 체크
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && registration) {
                console.log('[PWA] 탭 복귀 → SW 업데이트 체크');
                registration.update();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            if (intervalId) clearInterval(intervalId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    return null;
}
