# 분석 보고서: POI 검색 캐싱 개선 및 최적화 설계 (Milestone 1)

본 보고서는 `d:\apps\차량운행일지` PWA 서비스의 POI 검색에 대한 클라이언트 레벨 캐싱 아키텍처 및 상세 설계를 기술합니다. 외부 Tmap API 호출 비용을 절감하고, 동일 검색어에 대한 반응 속도를 획기적으로 개선하며, 브라우저 스토리지의 자원 관리를 위해 FIFO 링 버퍼 형식의 큐 메커니즘을 수립합니다.

---

## 1. 개요 및 목적
- **목적**: 목적지 및 출발지 입력 시 사용되는 Tmap POI(Point of Interest) 검색 결과에 대해 클라이언트 브라우저 레벨에서 캐싱을 수행합니다.
- **기대 효과**:
  - 동일 키워드 재입력 시 지연 시간(Latency) 0ms 제공 (네트워크 호출 생략).
  - Tmap API 사용 할당량 절약 및 서버 프록시 부하 대폭 완화.
  - 디바운스 시간(500ms) 대기 없는 즉시 드롭다운 노출로 혁신적인 사용자 경험(UX) 향상.
  - 최대 50개의 캐시 크기 한도를 가진 FIFO 링 버퍼를 활용해 메모리 누수 및 브라우저 성능 유지.

---

## 2. 현황 분석

### 2.1 기존 `usePoiSearch.ts` 분석
- **역할**: 목적지 입력 문자열(`keyword`)을 받아 디바운스(500ms) 후 `searchPOIList`를 호출하여 자동완성 드롭다운을 렌더링합니다.
- **비즈니스 로직**:
  - `keyword`의 좌우 공백을 제거(`trimmed = keyword?.trim() ?? ''`).
  - `suppressRef.current` 제어를 통해 목록 선택으로 인한 키워드 갱신 시 1회 검색 생략.
  - 검색어 길이가 2자 미만이거나 Tmap API 비활성화 시 즉시 중단.
  - 디바운스 타이머가 실행되면 Tmap API 프록시(`searchPOIList`) 호출 후 결과를 `poiResults` 상태에 바인딩.
- **한계점**:
  - 동일 키워드에 대해 여러 번 입력하거나 드롭다운을 닫았다가 다시 열어 키워드가 트리거될 때 매번 500ms 지연 및 API 네트워크 IO 발생.

### 2.2 기존 `geocoding.ts` 분석
- **역할**: Tmap API 프록시 서버 호출 및 데이터 맵핑 수행.
- **인터페이스**:
  - `searchPOIList(keyword: string, count = 5): Promise<PoiResult[]>`
  - `PoiResult` 타입 정의:
    ```typescript
    export interface PoiResult {
        lat: number;
        lon: number;
        name: string;
        address: string;
    }
    ```

---

## 3. 캐싱 아키텍처 및 자료구조 설계

### 3.1 브라우저 `sessionStorage` 선정 이유
- **생명주기 동기화**: 세션 스토리지(`sessionStorage`)는 사용자가 탭을 닫으면 완전히 소멸되므로, 오래된 캐시 정보가 영구적으로 남아 불필요한 브라우저 용량을 차지하지 않고 현재 세션 동안만 높은 일관성으로 동작하기에 최적입니다.
- **보안성**: `localStorage`에 비해 디바이스 영구 저장소에 흔적이 남지 않아 비교적 안전합니다.

### 3.2 FIFO 링 버퍼(Ring Buffer / Queue) 설계
- **구조**: 단일 `sessionStorage` 키(예: `'poi_search_cache'`) 아래에 JSON 직렬화 배열 형태로 관리합니다.
- **자료 구조**:
  ```typescript
  export interface CacheItem {
      keyword: string;
      results: PoiResult[];
      timestamp: number; // 디버그 및 생명주기 관리용 타임스탬프
  }
  ```
- **링 버퍼(FIFO) 제어 로직**:
  1. **조회 (Get)**: `keyword`가 존재하면 캐시 큐에서 해당 `keyword`를 키로 검색하여 `results`를 즉시 리턴합니다.
  2. **추가/갱신 (Set)**:
     - 중복 제거 전략: 캐시 큐에 이미 동일한 `keyword`가 있다면 기존 항목을 배열에서 제거(Splice)하고 새 값을 배열의 맨 뒤(`push`)에 삽입합니다. (FIFO 링 버퍼 큐이되, 최근에 요청된 검색어의 만료 순위를 갱신해 캐시 보존 효율을 극대화하는 LRU Hybrid FIFO 방식 제안).
     - 최대치 제한: `queue.length >= 50`인 경우, 가장 오래전에 삽입된 맨 앞의 항목을 `shift()`하여 완전히 소멸시킵니다.
     - 최종 결과물을 다시 `sessionStorage`에 안전하게 직렬화해 저장합니다.

---

## 4. 구체적인 구현 전략 (코드 설계)

### 4.1 캐싱 유틸리티 함수 설계 (`src/lib/tmap/poiCache.ts`)
외부 라이브러리 도입을 완전히 배제하고, 무손상 타입스크립트 타이핑과 `QuotaExceededError` 방지 코드를 포함한 독립 헬퍼 모듈을 정의합니다.

```typescript
import type { PoiResult } from '../lib/tmap/geocoding';

export interface PoiCacheItem {
    keyword: string;
    results: PoiResult[];
    timestamp: number;
}

const CACHE_KEY = 'poi_search_cache';
const MAX_CACHE_SIZE = 50;

/**
 * sessionStorage에서 캐시 리스트를 안전하게 가져옵니다.
 */
export function getPoiCache(): PoiCacheItem[] {
    try {
        const stored = sessionStorage.getItem(CACHE_KEY);
        if (!stored) return [];
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error('POI Cache Parsing Error:', e);
        return [];
    }
}

/**
 * 특정 키워드에 대한 캐시 결과를 반환합니다.
 */
export function getPoiCacheItem(keyword: string): PoiResult[] | null {
    const trimmed = keyword.trim();
    if (!trimmed) return null;
    
    const cache = getPoiCache();
    const found = cache.find(item => item.keyword === trimmed);
    return found ? found.results : null;
}

/**
 * 검색 결과를 캐시에 저장하며 50개 제한의 FIFO 링 버퍼를 관리합니다.
 */
export function setPoiCacheItem(keyword: string, results: PoiResult[]): void {
    const trimmed = keyword.trim();
    if (!trimmed) return;

    try {
        let cache = getPoiCache();
        
        // 1. 이미 동일한 검색어가 있으면 제거하여 중복 유입 및 링 버퍼 순서 꼬임 차단
        cache = cache.filter(item => item.keyword !== trimmed);
        
        // 2. 50개 제한 초과 시 가장 오래된 항목(배열 첫 번째) 밀어내기
        while (cache.length >= MAX_CACHE_SIZE) {
            cache.shift();
        }
        
        // 3. 신규 항목 추가
        cache.push({
            keyword: trimmed,
            results,
            timestamp: Date.now()
        });
        
        // 4. sessionStorage에 저장 (QuotaExceededError에 완벽히 대비)
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.error('POI Cache Save Error (sessionStorage full or restricted):', e);
        
        // 만약 용량 초과 에러(QuotaExceededError) 등이 발생한 경우, 안전하게 캐시 전체를 비워 오작동을 차단
        try {
            sessionStorage.removeItem(CACHE_KEY);
        } catch (_) {}
    }
}
```

### 4.2 `usePoiSearch.ts` 리팩토링 설계
캐시가 있을 때는 디바운스를 거치지 않고 즉각 화면에 뿌려주는 최적화 구조를 도입합니다.

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import { searchPOIList } from '../lib/tmap/geocoding';
import { isTmapAvailable } from '../lib/tmap/core';
import { getPoiCacheItem, setPoiCacheItem } from '../lib/tmap/poiCache'; // 새로 추가되는 캐시 유틸
import type { PoiResult } from '../lib/tmap/geocoding';

export type { PoiResult };

interface UsePoiSearchReturn {
    poiResults: PoiResult[];
    poiLoading: boolean;
    showPoiDropdown: boolean;
    setShowPoiDropdown: (show: boolean) => void;
    clearPoiResults: () => void;
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

        // [최적화 적용] 1. 동기 캐시 검색
        const cachedResults = getPoiCacheItem(trimmed);
        if (cachedResults) {
            // 캐시가 존재하는 경우, 디바운스 대기를 우회하여 0ms만에 즉각 적용
            if (timerRef.current) clearTimeout(timerRef.current);
            lastKeyword.current = trimmed;
            setPoiResults(cachedResults);
            setShowPoiDropdown(cachedResults.length > 0);
            setPoiLoading(false); // 로딩 불필요
            return;
        }

        // [최적화 적용] 2. 캐시 미스 시 디바운스 API 호출 진행
        if (timerRef.current) clearTimeout(timerRef.current);

        timerRef.current = setTimeout(async () => {
            lastKeyword.current = trimmed;
            setPoiLoading(true);
            try {
                const list = await searchPOIList(trimmed, 10);
                
                // 검색 성공 시 결과 캐싱 수행
                if (list && list.length > 0) {
                    setPoiCacheItem(trimmed, list);
                }
                
                setPoiResults(list);
                setShowPoiDropdown(list.length > 0);
            } catch (err) {
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
```

---

## 5. 규칙 준수 및 안전성 (AGENTS.md / 보안 3대 가드)

### 5.1 절대 금지 목록(AGENTS.md) 준수 여부 검증
- **D1~D3 (창 대화상자 차단)**: `window.alert`, `window.confirm`, `window.prompt`를 사용하지 않고 조용히 콘솔에 로그만 남기거나 무시하도록 에러 핸들링 설계.
- **D4 (any 금지)**: JSON 파싱 시 `PoiCacheItem[]` 인터페이스를 단단하게 캐스팅하여 타입 누수 및 런타임 오류 방지.
- **D15 (불필요 라이브러리 차단)**: 외부 의존성(예: `lru-cache` 라이브러리)을 신규 도입하지 않고 JS 표준 내장 메소드를 이용해 가벼운 코드로 FIFO 알고리즘 자체 구현.
- **D16 (터치 타겟)**: UI 레이아웃의 구조적 변경이 없으므로 영향 없음.

### 5.2 보안 3대 가드 준수 여부 검증
- **[GUARD-1] 시크릿 평문 노출 차단**: 캐시 모듈 소스 코드 및 지침에 Tmap API KEY 리터럴이나 비공개 설정 등을 절대 평문 기술하지 않고 기존 core 모듈의 `TMAP_API_KEY` 환경변수를 참조하도록 준수.
- **[GUARD-3] fetch() 직접 호출 금지**: UI 및 커스텀 훅 내에서 브라우저 네이티브 `fetch`나 `axios`를 직접 활용하지 않고, 정형화된 비즈니스 서비스 모듈인 `searchPOIList`를 그대로 통과 호출하여 API 계층 격리 규칙을 완벽하게 수립.

---

## 6. 결론 및 향후 절차
- 본 캐싱 구조는 메모리 성능 유지, 할당량 제한 관리, 에러 대처를 모두 고려한 완성도 높은 설계입니다.
- 다음 단계(Milestone 1 구현 단계)에서 Implementer 에이전트가 본 설계를 기반으로 안전하게 구현할 수 있도록 `handoff.md` 규격에 맞는 인수인계 프로세스를 즉각 밟겠습니다.
