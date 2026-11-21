/**
 * 새 버전 대기 상태 — "새 버전이 준비됐다"를 앱 어디서나 알 수 있게 한다.
 *
 * ## 왜 필요한가
 * 새 서비스 워커는 `skipWaiting()`으로 바로 활성화되지만, 열려 있는 탭은 일부러 자동
 * 새로고침하지 않는다(작성 중인 폼 유실 — main.tsx의 SW 정책 주석). 그동안은 이 사실을
 * 아무에게도 알리지 않아서, 옛 화면을 쓰다가 옛 파일을 못 찾는 순간에야 오류 화면을 봤다.
 * 이제 활성화 시점에 여기 표시해 두고, 두 곳이 이를 쓴다.
 * - `UpdateBanner`: "새 버전이 있어요 [지금 업데이트]" 안내 — 누를 때만 새로고침한다.
 * - `useApplyUpdateOnNavigation`: 사용자가 다른 화면으로 옮길 때 새 버전으로 연다.
 *
 * 표시는 탭(페이지) 하나의 메모리에만 둔다. 새로고침하면 새 버전이 떠 있으므로 지울 필요가 없다.
 */
import { reloadPage } from './browserNav';

let ready = false;
const listeners = new Set<() => void>();

/** 새 서비스 워커가 활성화됐다 — 이 탭은 옛 버전으로 떠 있다. */
export function markUpdateReady(): void {
    if (ready) return;
    ready = true;
    listeners.forEach((fn) => fn());
}

export function isUpdateReady(): boolean {
    return ready;
}

/** `useSyncExternalStore`용 구독. 해제 함수를 돌려준다. */
export function subscribeUpdateReady(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** SW 업데이트 확인을 기다리는 최대 시간. 회선이 느려도 버튼이 멈춘 것처럼 보이지 않게 한다. */
const UPDATE_CHECK_TIMEOUT_MS = 3000;

/**
 * 새 버전으로 다시 연다.
 *
 * 그냥 새로고침하면, 아직 새 워커를 받지 못한 기기는 옛 워커가 옛 화면을 다시 내준다 —
 * 오류 화면에서 [새로고침]을 눌러도 같은 화면이 되풀이되는 경우다. 그래서 먼저 워커
 * 업데이트를 한 번 확인하고(최대 3초) 새로고침한다. 확인이 실패해도 새로고침은 한다.
 */
export async function reloadToLatest(): Promise<void> {
    try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) {
            await Promise.race([
                reg.update(),
                new Promise((resolve) => setTimeout(resolve, UPDATE_CHECK_TIMEOUT_MS)),
            ]);
        }
    } catch {
        /* 업데이트 확인 실패는 무시 — 새로고침이 우선이다 */
    }
    reloadPage();
}

/** 테스트 전용: 상태를 처음으로 되돌린다. */
export function resetUpdateReadyForTest(): void {
    ready = false;
    listeners.clear();
}
