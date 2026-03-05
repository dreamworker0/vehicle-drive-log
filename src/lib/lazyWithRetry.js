import { lazy } from 'react';

/**
 * 새 배포 후 구버전 해시 청크를 요청할 때 발생하는
 * "Failed to fetch dynamically imported module" 에러를 방지하는 lazy 래퍼.
 *
 * 청크 로드 실패 시 sessionStorage 플래그를 이용해
 * 한 번만 강제 새로고침하고, 두 번째 실패 시에는 에러를 그대로 전파한다.
 */
export function lazyWithRetry(importFn) {
    return lazy(() =>
        importFn().catch((err) => {
            const retried = sessionStorage.getItem('chunk-reload-retried');
            if (!retried) {
                sessionStorage.setItem('chunk-reload-retried', '1');
                window.location.reload();
                // reload 될 때까지 resolve되지 않도록 pending Promise 반환
                return new Promise(() => { });
            }
            // 두 번째도 실패하면 에러를 그대로 throw (ErrorBoundary가 잡음)
            throw err;
        })
    );
}
