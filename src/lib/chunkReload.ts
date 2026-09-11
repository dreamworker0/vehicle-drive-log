/**
 * chunkReload — 새 배포 뒤 옛 청크를 요청했을 때의 복구
 *
 * ## 무엇이 깨지는가
 *
 * 파일명에 해시가 박힌 청크는 배포할 때마다 이름이 바뀌고, **옛 이름은 서버에서 사라진다.**
 * 그런데 서비스워커는 프리캐시한 `index.html`을 내주므로, 새 배포 직후에도 탭은 한동안
 * **옛 셸**로 시작한다. 그 셸이 참조하는 청크가 이 기기의 런타임 캐시에 없으면 네트워크로
 * 나가고, 서버에는 그 파일이 없다 — Hosting의 SPA 리라이트가 `index.html`을 돌려주므로
 * 브라우저는 `text/html`을 모듈로 받고 거절한다:
 *
 *   Failed to load module script: Expected a JavaScript-or-Wasm module script
 *   but the server responded with a MIME type of "text/html"
 *
 * 화면에는 "앱을 불러오지 못했습니다"가 뜬다. **네트워크 문제가 아닌데 네트워크를 확인하라고
 * 안내한다.** 실제로 2026-09-11 하루에 두 번 배포한 뒤 사용자가 이 화면을 만났다.
 *
 * ## 어떻게 복구하는가
 *
 * 새로고침하면 새 서비스워커의 셸을 받아 해결된다 — 사용자가 직접 다시 들어가면 괜찮아지는
 * 이유다. 그것을 자동으로 한 번만 한다.
 *
 * **그냥 리로드하지 않고 워커 교체를 기다린다.** 새 워커가 아직 활성화되지 않았으면 리로드해도
 * 같은 옛 셸이 나와 한 번뿐인 재시도 예산만 쓰고 끝난다. `sw.ts`가 `skipWaiting()`을 부르므로
 * 설치만 끝나면 곧 활성화되고, 그때 `controllerchange`가 온다. 상한을 두어 워커가 오지 않아도
 * 리로드는 한다 — 늦게라도 새 셸을 받을 가능성이 남는 편이 낫다.
 *
 * ## 왜 한 번뿐인가
 *
 * 리로드해도 계속 실패하는 경우(정말로 오프라인이거나 서버가 깨진 경우) 무한 리로드가 된다.
 * 예산은 `sessionStorage`에 두어 리로드를 건너뛰고 살아남는다. **저장소를 못 쓰는 환경에서는
 * 아예 재시도하지 않는다** — 예산을 기억하지 못하는 채로 리로드하면 그것이 곧 무한 루프다.
 */

const RETRY_KEY = 'chunk-reload-retried';

/** 새 워커가 활성화되기를 기다리는 상한. 넘기면 그냥 리로드한다. */
const SW_SWAP_TIMEOUT_MS = 3000;

/**
 * 청크를 받아 오는 데 성공했다 — 재시도 예산을 되돌린다.
 *
 * 플래그를 세션 내내 들고 있으면, 오래 열어 둔 탭에서 **두 번째 배포** 때의 청크 실패가
 * 곧바로 에러 화면으로 떨어진다. 리로드 직후 첫 성공에서 지우므로 무한 리로드는 생기지 않는다
 * (계속 실패하는 경우엔 성공이 없어 플래그가 남는다).
 */
export function noteChunkLoadSuccess(): void {
    try {
        sessionStorage.removeItem(RETRY_KEY);
    } catch { /* sessionStorage를 못 쓰는 환경 — 무시 */ }
}

async function reloadAfterServiceWorkerUpdate(): Promise<void> {
    try {
        const container = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
        // 워커가 제어하고 있지 않으면 셸은 네트워크에서 온다 — 기다릴 것이 없다.
        if (container?.controller) {
            const registration = await container.getRegistration();
            await registration?.update();
            await Promise.race([
                new Promise<void>((resolve) => {
                    container.addEventListener('controllerchange', () => resolve(), { once: true });
                }),
                new Promise<void>((resolve) => { setTimeout(resolve, SW_SWAP_TIMEOUT_MS); }),
            ]);
        }
    } catch { /* 워커가 없거나 갱신이 실패해도 리로드는 한다 */ }
    window.location.reload();
}

/**
 * 새 빌드를 받기 위해 **한 번만** 새로고침한다.
 *
 * @returns 리로드를 예약했으면 true. false면 이번 세션의 예산을 이미 썼다는 뜻이므로
 *          호출부는 에러를 그대로 드러내야 한다(두 번째 실패는 배포 문제가 아니다).
 */
export function retryOnceForNewBuild(): boolean {
    try {
        if (sessionStorage.getItem(RETRY_KEY)) return false;
        sessionStorage.setItem(RETRY_KEY, '1');
    } catch {
        // 예산을 기억하지 못하면 재시도 자체가 무한 루프가 된다
        return false;
    }
    void reloadAfterServiceWorkerUpdate();
    return true;
}
