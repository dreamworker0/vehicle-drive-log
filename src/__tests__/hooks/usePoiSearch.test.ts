import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PoiResult } from '../../hooks/usePoiSearch';

// tmap core 및 geocoding mock
const mockSearchPOIList = vi.fn();
vi.mock('../../lib/tmap/geocoding', () => ({
    searchPOIList: (keyword: string, limit?: number) => mockSearchPOIList(keyword, limit),
}));

const mockIsTmapAvailable = vi.fn().mockReturnValue(true);
vi.mock('../../lib/tmap/core', () => ({
    isTmapAvailable: () => mockIsTmapAvailable(),
}));

import { usePoiSearch } from '../../hooks/usePoiSearch';

describe('usePoiSearch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        if (typeof window !== 'undefined') {
            window.sessionStorage.clear();
        }
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('검색어가 2글자 미만일 때는 빈 결과를 반환한다', async () => {
        const { result } = renderHook(() => usePoiSearch('a'));
        expect(result.current.poiResults).toEqual([]);
        expect(result.current.showPoiDropdown).toBe(false);
    });

    it('캐시가 비어있을 때, 디바운스 시간이 지난 후에 searchPOIList를 호출하고 캐시에 저장한다', async () => {
        const mockResults: PoiResult[] = [{ name: '서울시청', lat: 37.5665, lon: 126.9780, address: '서울 중구 세종대로 110' }];
        mockSearchPOIList.mockResolvedValueOnce(mockResults);

        const { result } = renderHook(({ keyword }) => usePoiSearch(keyword), {
            initialProps: { keyword: '서울시청' },
        });

        // 처음에는 빈 배열
        expect(result.current.poiResults).toEqual([]);
        expect(result.current.poiLoading).toBe(false);

        // 타이머 진행
        await act(async () => {
            vi.advanceTimersByTime(500);
        });

        expect(mockSearchPOIList).toHaveBeenCalledWith('서울시청', 10);
        expect(result.current.poiResults).toEqual(mockResults);
        expect(result.current.showPoiDropdown).toBe(true);

        // sessionStorage 확인
        if (typeof window !== 'undefined') {
            const raw = window.sessionStorage.getItem('poi_search_cache');
            expect(raw).toBeDefined();
            const parsed = JSON.parse(raw!);
            expect(parsed.queue).toContain('서울시청');
            expect(parsed.data['서울시청']).toEqual(mockResults);
        }
    });

    it('캐시 히트 시에는 디바운스를 우회하고 0ms 만에 즉시 동기적으로 결과를 반환한다', async () => {
        const mockResults: PoiResult[] = [{ name: '강남역', lat: 37.4979, lon: 127.0276, address: '서울 강남구 강남대로 396' }];
        
        // 미리 세션스토리지에 캐시 적재
        if (typeof window !== 'undefined') {
            window.sessionStorage.setItem('poi_search_cache', JSON.stringify({
                queue: ['강남역'],
                data: { '강남역': mockResults }
            }));
        }

        const { result } = renderHook(() => usePoiSearch('강남역'));

        // 디바운스 대기 없이 즉시 결과 로드 (0ms)
        expect(result.current.poiResults).toEqual(mockResults);
        expect(result.current.showPoiDropdown).toBe(true);
        expect(mockSearchPOIList).not.toHaveBeenCalled();
    });

    it('FIFO 링 버퍼: 50개가 초과되면 가장 오래된 키워드와 데이터가 캐시에서 삭제된다', async () => {
        // 50개 키워드를 캐시에 적재
        const initialQueue: string[] = [];
        const initialData: Record<string, PoiResult[]> = {};
        for (let i = 1; i <= 50; i++) {
            const kw = `위치_${i}`;
            initialQueue.push(kw);
            initialData[kw] = [{ name: kw, lat: 37, lon: 126, address: '테스트 주소' }];
        }

        if (typeof window !== 'undefined') {
            window.sessionStorage.setItem('poi_search_cache', JSON.stringify({
                queue: initialQueue,
                data: initialData
            }));
        }

        // 새로운 51번째 키워드 검색 시도
        const mockResults: PoiResult[] = [{ name: '신규위치', lat: 37.5, lon: 126.5, address: '테스트 주소' }];
        mockSearchPOIList.mockResolvedValueOnce(mockResults);

        renderHook(() => usePoiSearch('신규위치'));

        // 타이머 진행
        await act(async () => {
            vi.advanceTimersByTime(500);
        });

        expect(mockSearchPOIList).toHaveBeenCalledWith('신규위치', 10);

        // 세션스토리지 FIFO 만료 확인
        if (typeof window !== 'undefined') {
            const raw = window.sessionStorage.getItem('poi_search_cache');
            const parsed = JSON.parse(raw!);
            // 큐 크기 50 유지
            expect(parsed.queue.length).toBe(50);
            // 가장 첫 번째 위치였던 '위치_1' 삭제 확인
            expect(parsed.queue).not.toContain('위치_1');
            expect(parsed.data['위치_1']).toBeUndefined();
            // '위치_2'는 여전히 존재
            expect(parsed.queue).toContain('위치_2');
            // '신규위치' 신규 등록 확인
            expect(parsed.queue).toContain('신규위치');
            expect(parsed.data['신규위치']).toEqual(mockResults);
        }
    });

    it('QuotaExceededError 등 스토리지 예외 발생 시 캐시가 리셋된다', async () => {
        // sessionStorage.setItem이 에러를 발생시키도록 모킹
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });

        const mockResults: PoiResult[] = [{ name: '에러테스트', lat: 37, lon: 126, address: '테스트 주소' }];
        mockSearchPOIList.mockResolvedValueOnce(mockResults);

        const { result } = renderHook(() => usePoiSearch('에러테스트'));

        await act(async () => {
            vi.advanceTimersByTime(500);
        });

        expect(result.current.poiResults).toEqual(mockResults);
        // setItemSpy가 호출되었는지 검증
        expect(setItemSpy).toHaveBeenCalled();

        setItemSpy.mockRestore();
    });
});
