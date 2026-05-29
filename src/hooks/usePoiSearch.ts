/**
 * usePoiSearch — 목적지 입력 시 POI 후보 목록 검색 (debounce 적용 및 sessionStorage 캐싱)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { searchPOIList } from '../lib/tmap/geocoding';
import { isTmapAvailable } from '../lib/tmap/core';
import type { PoiResult } from '../lib/tmap/geocoding';

export type { PoiResult };

interface UsePoiSearchReturn {
    poiResults: PoiResult[];
    poiLoading: boolean;
    showPoiDropdown: boolean;
    setShowPoiDropdown: (show: boolean) => void;
    clearPoiResults: () => void;
    /** 선택으로 인한 keyword 변경 시 다음 검색을 1회 스킵 */
    suppressNext: () => void;
}

// === POI 검색 캐시 관련 인터페이스 및 헬퍼 함수 정의 ===
interface PoiCacheData {
    queue: string[];
    data: Record<string, PoiResult[]>;
}

const CACHE_KEY = 'poi_search_cache';
const MAX_CACHE_SIZE = 50;

function getPoiCache(): PoiCacheData {
    if (typeof window === 'undefined') {
        return { queue: [], data: {} };
    }
    try {
        const raw = window.sessionStorage.getItem(CACHE_KEY);
        if (!raw) return { queue: [], data: {} };
        const parsed = JSON.parse(raw);
        if (
            parsed &&
            Array.isArray(parsed.queue) &&
            parsed.data &&
            typeof parsed.data === 'object'
        ) {
            return parsed as PoiCacheData;
        }
    } catch (e) {
        console.error('POI 검색 캐시 로드 실패 (초기화):', e);
    }
    return { queue: [], data: {} };
}

function setPoiCache(cache: PoiCacheData): void {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.error('POI 검색 캐시 저장 실패:', e);
        // QuotaExceeded 가드: 스토리지 한도 도달 시 전체 리셋하여 안전장치 확보
        try {
            window.sessionStorage.removeItem(CACHE_KEY);
        } catch {
            // 무시
        }
    }
}

function addPoiToCache(keyword: string, results: PoiResult[]): void {
    const cache = getPoiCache();
    // 중복 제거: 이미 큐에 존재하는 키워드인 경우 제거 후 마지막에 다시 추가하여 최신 순서 유지
    const index = cache.queue.indexOf(keyword);
    if (index !== -1) {
        cache.queue.splice(index, 1);
    }

    cache.queue.push(keyword);
    cache.data[keyword] = results;

    // FIFO 링 버퍼 관리: 50개를 초과할 때 가장 오래된 키워드 제거
    while (cache.queue.length > MAX_CACHE_SIZE) {
        const oldest = cache.queue.shift();
        if (oldest) {
            delete cache.data[oldest];
        }
    }

    setPoiCache(cache);
}

function getPoiFromCache(keyword: string): PoiResult[] | null {
    const cache = getPoiCache();
    if (cache.data && cache.data[keyword]) {
        return cache.data[keyword];
    }
    return null;
}

export function usePoiSearch(keyword: string, debounceMs = 500): UsePoiSearchReturn {
    const [poiResults, setPoiResults] = useState<PoiResult[]>([]);
    const [poiLoading, setPoiLoading] = useState(false);
    const [showPoiDropdown, setShowPoiDropdown] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastKeyword = useRef('');
    const suppressRef = useRef(false);

    const clearPoiResults = useCallback(() => {
        setPoiResults([]);
        setShowPoiDropdown(false);
    }, []);

    const suppressNext = useCallback(() => {
        suppressRef.current = true;
    }, []);

    useEffect(() => {
        const trimmed = keyword?.trim() ?? '';

        // 선택으로 인한 변경은 검색 스킵 (1회)
        if (suppressRef.current) {
            suppressRef.current = false;
            return;
        }

        // 짧거나 TMap 사용 불가 시 드롭다운 닫기
        if (trimmed.length < 2 || !isTmapAvailable()) {
            setPoiResults([]);
            setShowPoiDropdown(false);
            return;
        }

        // 같은 키워드 재검색 방지
        if (trimmed === lastKeyword.current) return;

        // 캐시 히트 시 (Debounce Bypass): 500ms 디바운스를 생략하고 0ms 만에 신속하게 결과 표시 후 즉시 종료
        const cached = getPoiFromCache(trimmed);
        if (cached) {
            if (timerRef.current) clearTimeout(timerRef.current);
            lastKeyword.current = trimmed;
            setPoiResults(cached);
            setShowPoiDropdown(cached.length > 0);
            return;
        }

        if (timerRef.current) clearTimeout(timerRef.current);

        timerRef.current = setTimeout(async () => {
            lastKeyword.current = trimmed;
            setPoiLoading(true);
            try {
                const list = await searchPOIList(trimmed, 10);
                setPoiResults(list);
                setShowPoiDropdown(list.length > 0);
                
                // 결과가 유효하게 존재하는 정상 케이스에 대해서만 캐시에 새로 저장
                if (list && list.length > 0) {
                    addPoiToCache(trimmed, list);
                }
            } catch {
                setPoiResults([]);
                setShowPoiDropdown(false);
            } finally {
                setPoiLoading(false);
            }
        }, debounceMs);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [keyword, debounceMs]);

    return { poiResults, poiLoading, showPoiDropdown, setShowPoiDropdown, clearPoiResults, suppressNext };
}

