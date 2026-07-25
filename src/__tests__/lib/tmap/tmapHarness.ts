/**
 * tmap 테스트 공용 하네스
 *
 * core 모듈은 쿨다운·요청 큐·캐시를 모듈 전역 상태로 들고 있어, 테스트 간 누수를 막으려면
 * 매번 vi.resetModules()로 새로 적재해야 한다. (core를 vi.mock으로 감싸면 팩토리 결과가
 * 재사용되어 쿨다운이 다음 테스트로 새므로, 여기서는 global fetch만 대체한다.)
 *
 * 또 글로벌 큐가 요청 사이에 1200ms 간격을 강제하므로, 다중 호출 시나리오는
 * 가짜 타이머로 시간을 건너뛰어야 한다. settle()이 그 역할을 한다.
 */
import { vi } from 'vitest';

/** 큐의 요청 간 간격을 건너뛰며 프라미스를 완료시킨다 (가짜 타이머 필요) */
export async function settle<T>(promise: Promise<T>): Promise<T> {
    // 거부 핸들러를 동기적으로 붙여 unhandled rejection 경고를 막는다
    const guarded = promise.then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
    );
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await guarded;
    if (!result.ok) throw result.error;
    return result.value;
}

/** T-Map POI 검색 응답 */
export function poiResponse(...pois: Record<string, string>[]) {
    return { searchPoiInfo: { pois: { poi: pois } } };
}

/** T-Map 지오코딩(fullAddrGeo) 응답 */
export function geoResponse(coord: Record<string, string>) {
    return { coordinateInfo: { coordinate: [coord] } };
}

/** T-Map 경로탐색 응답 (m·초 단위 원본) */
export function routeResponse(opts: {
    totalDistance: number;
    totalTime: number;
    totalFare?: number;
    taxiFare?: number;
}) {
    return { features: [{ properties: { ...opts } }] };
}

/** fetch 응답 스텁 — 본문을 JSON 문자열로 돌려준다 */
export function okJson(body: unknown) {
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
}
