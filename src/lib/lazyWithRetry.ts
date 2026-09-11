import { lazy } from 'react';
import { noteChunkLoadSuccess, retryOnceForNewBuild } from './chunkReload';

/**
 * 새 배포 후 구버전 해시 청크를 요청할 때 발생하는
 * "Failed to fetch dynamically imported module" 에러를 방지하는 lazy 래퍼.
 *
 * 청크 로드 실패 시 한 번만 강제 새로고침하고, 두 번째 실패 시에는 에러를 그대로 전파한다.
 * 재시도 예산과 서비스워커 교체 대기는 `chunkReload`가 가진다 — 부팅 경로(main.tsx)와
 * 같은 예산을 써야 두 곳이 각각 한 번씩 리로드하는 일이 없다.
 *
 * 전 탭 동시 자동 리로드를 없앤 뒤(main.tsx 참고) 이 경로가 새 버전을 반영하는 주 경로가
 * 됐다 — 그래서 **로드에 성공하면 재시도 예산을 되돌린다.**
 */
export function lazyWithRetry(importFn: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) {
    return lazy(() =>
        importFn().then((mod) => {
            noteChunkLoadSuccess();
            return mod;
        }).catch((err) => {
            if (retryOnceForNewBuild()) {
                // reload 될 때까지 resolve되지 않도록 pending Promise 반환
                return new Promise<{ default: React.ComponentType<Record<string, unknown>> }>(() => { });
            }
            // 두 번째도 실패하면 에러를 그대로 throw (ErrorBoundary가 잡음)
            throw err;
        })
    );
}
