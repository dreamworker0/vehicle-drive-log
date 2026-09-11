import { lazy } from 'react';

const RETRY_KEY = 'chunk-reload-retried';

/**
 * 새 배포 후 구버전 해시 청크를 요청할 때 발생하는
 * "Failed to fetch dynamically imported module" 에러를 방지하는 lazy 래퍼.
 *
 * 청크 로드 실패 시 sessionStorage 플래그를 이용해
 * 한 번만 강제 새로고침하고, 두 번째 실패 시에는 에러를 그대로 전파한다.
 *
 * 전 탭 동시 자동 리로드를 없앤 뒤(main.tsx 참고) 이 경로가 새 버전을 반영하는 주 경로가
 * 됐다 — 그래서 **로드에 성공하면 재시도 예산을 되돌린다.** 플래그를 세션 내내 들고 있으면
 * 오래 열어둔 탭에서 두 번째 배포 때의 청크 실패가 곧바로 에러 화면으로 떨어진다.
 * 리로드 직후 첫 성공에서 지우므로 무한 리로드는 생기지 않는다(리로드해도 계속 실패하는
 * 경우엔 성공이 없어 플래그가 남아 두 번째 실패에서 그대로 throw된다).
 */
export function lazyWithRetry(importFn: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) {
    return lazy(() =>
        importFn().then((mod) => {
            try {
                sessionStorage.removeItem(RETRY_KEY);
            } catch { /* sessionStorage를 못 쓰는 환경(사파리 프라이빗 등) — 무시 */ }
            return mod;
        }).catch((err) => {
            const retried = sessionStorage.getItem(RETRY_KEY);
            if (!retried) {
                sessionStorage.setItem(RETRY_KEY, '1');
                window.location.reload();
                // reload 될 때까지 resolve되지 않도록 pending Promise 반환
                return new Promise<{ default: React.ComponentType<Record<string, unknown>> }>(() => { });
            }
            // 두 번째도 실패하면 에러를 그대로 throw (ErrorBoundary가 잡음)
            throw err;
        })
    );
}
