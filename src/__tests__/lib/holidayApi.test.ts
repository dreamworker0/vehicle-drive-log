/**
 * holidayApi — 외부 공공데이터 API 폴백 타임아웃 검증
 *
 * 회귀 대상: 폴백 fetch에 타임아웃이 없어 외부 서비스가 응답하지 않으면 무기한 대기했고,
 * 이 Promise를 await하던 화면이 그대로 인질이 되던 결함(Phase 122 부수 발견).
 *
 * 모듈 전역에 연도별 메모리 캐시가 있으므로 케이스마다 resetModules로 격리한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(() => ({})),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));
vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../lib/authFetch', () => ({ getAuthHeaders: vi.fn().mockResolvedValue({}) }));

/** signal.abort()에 반응하는 fetch — 실제 브라우저 동작을 따른다. */
function neverRespondingFetch() {
    return vi.fn((_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
                reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
            });
        })
    );
}

async function loadModule() {
    vi.resetModules();
    return (await import('../../lib/holidayApi')).fetchPublicHolidays;
}

describe('fetchPublicHolidays — 외부 폴백 타임아웃', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Firestore에 해당 연도가 없어야 외부 API 폴백 경로로 들어간다
        mockGetDoc.mockResolvedValue({ exists: () => false });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('외부 API가 응답하지 않으면 5초에 중단하고 빈 결과로 진행한다', async () => {
        vi.useFakeTimers();
        const fetchMock = neverRespondingFetch();
        vi.stubGlobal('fetch', fetchMock);

        const fetchPublicHolidays = await loadModule();
        const pending = fetchPublicHolidays(2031);

        await vi.advanceTimersByTimeAsync(5000);

        // 무기한 대기하지 않고 해소된다 — 이것이 무한 스피너를 막는 지점
        await expect(pending).resolves.toEqual({});
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    });

    it('5초 전에는 중단하지 않는다', async () => {
        vi.useFakeTimers();
        const fetchMock = neverRespondingFetch();
        vi.stubGlobal('fetch', fetchMock);

        const fetchPublicHolidays = await loadModule();
        void fetchPublicHolidays(2032);
        await vi.advanceTimersByTimeAsync(4999);

        expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
    });

    it('Firestore에 데이터가 있으면 외부 API를 부르지 않는다 (정상 경로)', async () => {
        const fetchMock = neverRespondingFetch();
        vi.stubGlobal('fetch', fetchMock);
        mockGetDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({ '2033': { '2033-08-15': '광복절' } }),
        });

        const fetchPublicHolidays = await loadModule();
        await expect(fetchPublicHolidays(2033)).resolves.toEqual({ '2033-08-15': '광복절' });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
