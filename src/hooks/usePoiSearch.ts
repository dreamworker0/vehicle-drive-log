/**
 * usePoiSearch — 목적지 입력 시 POI 후보 목록 검색 (debounce 적용)
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

        if (timerRef.current) clearTimeout(timerRef.current);

        timerRef.current = setTimeout(async () => {
            lastKeyword.current = trimmed;
            setPoiLoading(true);
            try {
                const list = await searchPOIList(trimmed, 5);
                setPoiResults(list);
                setShowPoiDropdown(list.length > 0);
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
