import { useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';

/** SW 업데이트 체크 간격 (10분) */
const SW_CHECK_INTERVAL = 10 * 60 * 1000;

export default function UpdatePrompt() {
    useEffect(() => {
        let intervalId: ReturnType<typeof setInterval> | undefined;
        let registration: ServiceWorkerRegistration | undefined;

        registerSW({
            // 새 워커가 activate되면 vite-plugin-pwa는 기본적으로 window.location.reload()를
            // 부른다(autoUpdate 모드). skipWaiting 때문에 activate는 열려 있는 모든 탭에서
            // 동시에 관측되므로, 그 기본 동작은 탭 전부를 한꺼번에 새로고침한다.
            // onNeedReload를 제공하면 그 자동 리로드를 우리가 가로챌 수 있다 — 여기서는
            // 리로드하지 않고 다음 내비게이션에 맡긴다(main.tsx의 정책 주석 참고).
            onNeedReload() {
                console.debug('[PWA] 새 버전 활성화 — 다음 내비게이션에서 반영');
            },
            onOfflineReady() {
                console.debug('[PWA] 오프라인 사용 준비 완료');
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
                console.debug('[PWA] 탭 복귀 → SW 업데이트 체크');
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
