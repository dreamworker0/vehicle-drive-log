import { useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';

export default function UpdatePrompt() {
    useEffect(() => {
        let intervalId: ReturnType<typeof setTimeout>;
        const updateSW = registerSW({
            onNeedRefresh() {
                console.log('[PWA] 새 버전 감지 → 자동 업데이트 적용');
                updateSW(true);
            },
            onOfflineReady() {
                console.log('[PWA] 오프라인 사용 준비 완료');
            },
            onRegisteredSW(_swUrl, registration) {
                if (registration) {
                    intervalId = setInterval(() => {
                        registration.update();
                    }, 60 * 60 * 1000);
                }
            },
        });
        return () => { if (intervalId) clearInterval(intervalId); };
    }, []);

    return null;
}
