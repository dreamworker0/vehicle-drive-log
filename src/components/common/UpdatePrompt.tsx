import { useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { checkForSwUpdate } from '../../lib/swUpdate';
import { markUpdateReady } from '../../lib/pendingUpdate';
import UpdateBanner from './UpdateBanner';

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
            // 리로드하지 않고 새 버전이 준비됐다고만 표시한다(main.tsx의 정책 주석 참고).
            // 표시를 보고 UpdateBanner가 안내 띠를 띄우고, 다음 화면 이동 때 새 버전을 연다.
            onNeedReload() {
                console.debug('[PWA] 새 버전 활성화 — 안내 띠 표시, 다음 화면 이동에서 반영');
                markUpdateReady();
            },
            onOfflineReady() {
                console.debug('[PWA] 오프라인 사용 준비 완료');
            },
            onRegisteredSW(_swUrl, reg) {
                registration = reg;
                if (reg) {
                    // 10분마다 주기적 업데이트 체크
                    intervalId = setInterval(() => {
                        checkForSwUpdate(reg);
                    }, SW_CHECK_INTERVAL);
                }
            },
        });

        // 탭 복귀(visibility change) 시 즉시 SW 업데이트 체크
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && registration) {
                console.debug('[PWA] 탭 복귀 → SW 업데이트 체크');
                checkForSwUpdate(registration);
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            if (intervalId) clearInterval(intervalId);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    // 새 버전이 준비되기 전에는 아무것도 그리지 않는다(UpdateBanner가 null을 돌려준다).
    return <UpdateBanner />;
}
