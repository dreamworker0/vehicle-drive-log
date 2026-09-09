/**
 * 로그아웃 시 Firestore 캐시 폐기의 **미완료 표식**과 재시도 오케스트레이션.
 *
 * ## 왜 별 모듈인가
 * 이 판정은 공용 기기에서 이전 사용자의 문서 캐시가 남는지를 가른다(2026-07-10 감사 #8).
 * 그런데 `firebase.ts`는 모듈 로드 시 Firebase 전체를 초기화해 단위 테스트로 들이기 어렵다.
 * 그래서 **표식과 순서 계약만** 여기로 떼어 낸다 — 실제 `terminate`·`clearIndexedDbPersistence`는
 * 호출부가 주입한다.
 *
 * ## 무엇을 지키려는 계약인가
 *  1. **시도 전에** 표식을 적는다. 도중에 탭이 닫히거나 프로세스가 죽어도 미완료로 남아야 한다.
 *  2. 표식은 **성공했을 때만** 지운다. 실패를 성공으로 오해하면 캐시가 영구히 남는다.
 *  3. 표식이 없으면 재시도는 **아무 일도 하지 않는다** — 정상 경로에 비용을 얹지 않는다.
 *
 * 대표적인 실패 원인은 다중 탭이다. `persistentMultipleTabManager`로 캐시를 공유하므로 다른
 * 탭이 붙어 있으면 `clearIndexedDbPersistence`가 `failed-precondition`으로 거부되고, 그 탭을
 * 우리가 닫을 수는 없다. 그러니 성공할 때까지 표식을 들고 있다가 **다른 탭이 닫힌 첫 부팅**에
 * 정리하는 것이 유일하게 확실한 방법이다.
 */

/**
 * `localStorage`에 두는 것이 요점이다 — 로그아웃은 곧 하드 내비게이션이고, 실패의 대표
 * 원인인 다중 탭은 브라우저를 닫아야 풀리는 경우가 많아 세션 저장소로는 살아남지 못한다.
 */
export const PENDING_CACHE_CLEAR_KEY = 'firestore_cache_clear_pending_v1';

/** 저장소 접근은 사생활 보호 모드·차단 설정에서 throw 한다 — 표식 때문에 로그아웃을 막지 않는다. */
export function markCacheClearPending(): void {
    try { localStorage.setItem(PENDING_CACHE_CLEAR_KEY, String(Date.now())); } catch { /* 저장 불가 환경 */ }
}

export function clearCacheClearPending(): void {
    try { localStorage.removeItem(PENDING_CACHE_CLEAR_KEY); } catch { /* 저장 불가 환경 */ }
}

export function hasCacheClearPending(): boolean {
    try { return localStorage.getItem(PENDING_CACHE_CLEAR_KEY) !== null; } catch { return false; }
}

/**
 * 로그아웃 경로 — 표식을 적고 폐기를 시도한다. 실패는 삼키되 표식을 남긴다.
 *
 * `terminate`를 먼저 부르는 순서는 그대로다(폐기는 종료된 인스턴스에서만 허용된다).
 * 어느 단계에서 실패해도 표식이 남아 다음 부팅이 이어받는다.
 */
export async function runCacheClearWithMarker(
    terminateFn: () => Promise<void>,
    clearFn: () => Promise<void>,
    onError: (err: unknown) => void,
): Promise<void> {
    markCacheClearPending();
    try {
        await terminateFn();
        await clearFn();
        clearCacheClearPending();
    } catch (err) {
        onError(err);
    }
}

/**
 * 부팅 경로 — 지난 로그아웃에서 끝내지 못한 폐기를 다시 시도한다.
 *
 * @returns 이번에 정리했으면 `'cleared'`, 할 일이 없었으면 `'skipped'`, 다시 실패했으면 `'failed'`
 */
export async function runPendingCacheClear(
    clearFn: () => Promise<void>,
    onError: (err: unknown) => void,
): Promise<'cleared' | 'skipped' | 'failed'> {
    if (!hasCacheClearPending()) return 'skipped';
    try {
        await clearFn();
        clearCacheClearPending();
        return 'cleared';
    } catch (err) {
        // 다른 탭이 점유 중이거나 이미 인스턴스가 시작된 경우다. 표식은 남긴다.
        onError(err);
        return 'failed';
    }
}
