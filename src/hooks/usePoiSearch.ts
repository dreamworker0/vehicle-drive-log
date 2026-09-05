/**
 * usePoiSearch — 목적지 입력 시 POI 후보 목록 검색 (debounce 적용 및 localStorage 캐싱)
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

/**
 * 캐시 키.
 *
 * 영속화하면서 버전을 붙인다(`geoCache`의 `tmap_geo_cache_v1`과 같은 방식). PoiResult 모양이
 * 바뀌어도 옛 항목이 무한정 남지 않게 — `loadCache`는 queue가 배열이고 data가 객체인지만
 * 보므로 모양이 달라진 항목을 걸러내지 못한다. sessionStorage 시절의 옛 키는 탭을 닫으면
 * 알아서 사라지므로 옮겨 담지 않는다.
 */
const CACHE_KEY = 'poi_search_cache_v1';
const MAX_CACHE_SIZE = 50;

/**
 * 캐시를 메모리에 올려 두고, 쓰기 때마다 localStorage로 흘려보낸다.
 *
 * 두 가지를 한꺼번에 고친다.
 *  1. **저장소** — 예전에는 sessionStorage라 탭을 닫으면 사라졌고, 같은 목적지를 내일 또
 *     검색하면 API를 또 불렀다. 기관 차량의 행선지는 반복이 심하고(같은 복지관·병원·
 *     어르신 댁), 모바일 PWA는 세션이 더 자주 끊긴다. `geoCache`·`routeCache`는 이미
 *     localStorage를 쓰는데 이 캐시만 달랐다.
 *  2. **읽기 비용** — 예전에는 글자를 칠 때마다 저장소에서 JSON 전체를 파싱했다. 이제
 *     읽기는 메모리에서 끝나고, 저장소는 새 검색어가 생길 때만 건드린다.
 */
function loadCache(): PoiCacheData {
    if (typeof window === 'undefined') return { queue: [], data: {} };
    try {
        const raw = window.localStorage.getItem(CACHE_KEY);
        if (!raw) return { queue: [], data: {} };
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.queue) && parsed.data && typeof parsed.data === 'object') {
            return parsed as PoiCacheData;
        }
    } catch (e) {
        console.error('POI 검색 캐시 로드 실패 (초기화):', e);
    }
    return { queue: [], data: {} };
}

const cache: PoiCacheData = loadCache();

function persistCache(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.error('POI 검색 캐시 저장 실패:', e);
        // QuotaExceeded 가드.
        //
        // ⚠️ 저장소만 비우면 안 된다. 메모리 캐시는 그대로 50건이라 다음 쓰기도 같은 크기로
        // 다시 실패하고, 그 뒤로 **영원히** 저장이 안 된다 — 캐시를 세션 너머로 남기려던
        // 목적이 조용히 무효가 되고 콘솔 에러만 쌓인다. 예전(sessionStorage) 구현은 저장소를
        // 비우면 다음 쓰기가 작은 크기로 다시 성공해 스스로 회복했다.
        // 그래서 메모리도 함께 줄여 회복 여지를 만든다. 최근 것부터 남긴다.
        const keep = cache.queue.slice(-Math.max(1, Math.floor(cache.queue.length / 2)));
        const kept = new Set(keep);
        for (const k of Object.keys(cache.data)) if (!kept.has(k)) delete cache.data[k];
        cache.queue.length = 0;
        cache.queue.push(...keep);
        try {
            window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch {
            // 줄여도 안 되면 저장소 항목을 치우고 이번 세션은 메모리로만 간다.
            try { window.localStorage.removeItem(CACHE_KEY); } catch { /* 무시 */ }
        }
    }
}

function addPoiToCache(keyword: string, results: PoiResult[]): void {
    // 중복 제거: 이미 큐에 있으면 빼고 맨 뒤에 다시 넣어 최신 순서를 유지한다.
    const index = cache.queue.indexOf(keyword);
    if (index !== -1) cache.queue.splice(index, 1);

    cache.queue.push(keyword);
    cache.data[keyword] = results;

    // FIFO 링 버퍼: 50개를 넘으면 가장 오래된 것부터 버린다.
    while (cache.queue.length > MAX_CACHE_SIZE) {
        const oldest = cache.queue.shift();
        if (oldest) delete cache.data[oldest];
    }

    persistCache();
}

/**
 * 테스트용 — 저장소에서 캐시를 다시 읽어 메모리를 맞춘다.
 *
 * 캐시는 모듈이 로드될 때 한 번만 저장소를 읽는다(실제 앱에서는 페이지 로드 시점이라
 * 그걸로 충분하다). 테스트는 import 이후에 저장소를 심으므로 이 함수로 그 시점을 재현한다.
 */
export function __reloadPoiCacheForTest(): void {
    const fresh = loadCache();
    cache.queue.length = 0;
    cache.queue.push(...fresh.queue);
    for (const k of Object.keys(cache.data)) delete cache.data[k];
    Object.assign(cache.data, fresh.data);
}

function getPoiFromCache(keyword: string): PoiResult[] | null {
    return cache.data[keyword] ?? null;
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

