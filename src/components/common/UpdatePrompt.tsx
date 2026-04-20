import { useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';

/** SW 업데이트 체크 간격 (10분) */
const SW_CHECK_INTERVAL = 10 * 60 * 1000;

export default function UpdatePrompt() {
    useEffect(() => {
        let intervalId: ReturnType<typeof setInterval> | undefined;
        let registration: ServiceWorkerRegistration | undefined;

        const updateSW = registerSW({
            onNeedRefresh() {
                console.log('[PWA] 새 버전 감지 → 자동 업데이트 적용');
                // updateSW(true)는 Promise를 반환 — .catch()로 비동기 에러도 처리
                Promise.resolve(updateSW(true)).catch(() => {
                    // iOS Safari에서 newestWorker가 null인 경우
                    // InvalidStateError 발생 — 페이지 새로고침으로 대체
                    console.warn('[PWA] SW 업데이트 실패, 새로고침으로 대체');
                    window.location.reload();
                });
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
