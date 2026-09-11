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
 * 새로고침하면 새 워커의 셸을 받아 해결된다 — 사용자가 직접 다시 들어가면 괜찮아지는
 * 이유다. 그것을 자동으로 **한 번만** 한다. `main.tsx`(부팅)와 `lazyWithRetry`(라우트)가
 * 같은 예산을 나눠 쓴다 — 따로 두면 한 세션에서 두 번 리로드할 수 있다.
 *
 * ## 왜 즉시 리로드하는가 — 서비스워커를 기다리지 않는다
 *
 * 처음에는 "새 워커가 활성화될 때까지 기다렸다가(최대 3초) 리로드"로 썼다. 둘 다 틀렸다.
 *
 *   1. **기다림이 성립하지 않는다.** `sw.ts`는 `clientsClaim`을 의도적으로 쓰지 않으므로
 *      (그 파일 주석 참고) 현재 클라이언트에는 `controllerchange`가 오지 않는다. 즉 상한
 *      3초를 매번 그대로 소진한다.
 *   2. **지연된 리로드가 남의 네비게이션을 가로챈다.** 실측했다 — E2E에서
 *      `Navigation to "/" is interrupted by another navigation to "/"`로 여러 건이 깨졌다.
 *      사용자 화면에서도 같은 일이 일어난다: 실패 3초 뒤에 리로드가 터지면 그 사이 옮겨 간
 *      화면에서 되돌려진다.
 *
 * 기다릴 필요도 없다. 네비게이션은 등록의 **활성** 워커가 처리하므로 `clientsClaim` 없이도
 * 새 워커가 활성화돼 있으면 리로드가 새 셸을 받는다. `main.tsx`가 부팅 때 `reg.update()`를
 * 부르므로 대개 그 시점에 이미 설치가 진행 중이다. 아직이라면 두 번째 실패에서 에러 화면이
 * 뜬다 — 고치기 전과 같은 자리이므로 나빠지지 않는다.
 *
 * ## 왜 한 번뿐인가
 *
 * 리로드해도 계속 실패하는 경우(정말로 오프라인이거나 서버가 깨진 경우) 무한 리로드가 된다.
 * 예산은 `sessionStorage`에 두어 리로드를 건너뛰고 살아남는다. **저장소를 못 쓰는 환경에서는
 * 아예 재시도하지 않는다** — 예산을 기억하지 못하는 채로 리로드하면 그것이 곧 무한 루프다.
 */

const RETRY_KEY = 'chunk-reload-retried';

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

/**
 * 새 빌드를 받기 위해 **한 번만** 새로고침한다.
 *
 * @returns 리로드했으면 true. false면 이번 세션의 예산을 이미 썼다는 뜻이므로
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
    window.location.reload();
    return true;
}
