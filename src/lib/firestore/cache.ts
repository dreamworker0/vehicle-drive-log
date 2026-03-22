/**
 * Firestore 인메모리 캐시 레이어
 * 동일한 쿼리가 여러 훅에서 독립 호출되는 문제를 해결하기 위한 TTL 기반 캐시.
 * 예: getVehicles(orgId)가 4곳에서 독립 호출 → 캐시로 1회만 실행
 */

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
    promise?: Promise<T>;
}

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * TTL 기반 캐시 래퍼. 같은 키의 요청이 TTL 내에 재호출되면 캐시된 결과를 반환.
 * 동시 요청(race condition)도 하나의 Promise로 병합.
 *
 * @param key 캐시 키 (예: `vehicles:org123`)
 * @param fetcher 실제 데이터를 가져오는 함수
 * @param ttlMs 캐시 유효 시간 (기본 30초)
 */
export async function cachedQuery<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs = 30_000,
): Promise<T> {
    const now = Date.now();
    const existing = cache.get(key) as CacheEntry<T> | undefined;

    // 캐시 히트: TTL 내
    if (existing && existing.expiresAt > now) {
        return existing.data;
    }

    // 동시 요청 병합: 이미 진행 중인 Promise가 있으면 재사용
    if (existing?.promise) {
        return existing.promise;
    }

    const promise = fetcher().then((data) => {
        cache.set(key, { data, expiresAt: Date.now() + ttlMs });
        return data;
    }).catch((err) => {
        // 실패 시 캐시에서 제거하여 다음 호출에서 재시도
        cache.delete(key);
        throw err;
    });

    // 진행 중 표시 (동시 요청 병합용)
    cache.set(key, { data: undefined as T, expiresAt: 0, promise });

    return promise;
}

/**
 * 특정 키 또는 전체 캐시를 무효화.
 * 데이터 변경(create/update/delete) 후 호출하면 다음 조회에서 최신 데이터 반환.
 *
 * @param keyOrPrefix 특정 키 또는 접두사. 생략 시 전체 캐시 클리어.
 */
export function invalidateCache(keyOrPrefix?: string): void {
    if (!keyOrPrefix) {
        cache.clear();
        return;
    }
    // 정확히 일치하거나 접두사로 시작하는 키 모두 삭제
    for (const key of cache.keys()) {
        if (key === keyOrPrefix || key.startsWith(keyOrPrefix + ':')) {
            cache.delete(key);
        }
    }
}
