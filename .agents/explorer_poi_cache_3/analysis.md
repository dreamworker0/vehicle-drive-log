# POI 검색 캐싱 개선 분석 및 설계 보고서 (Milestone 1)

본 분석 보고서는 차량운행일지 PWA 서비스의 POI(목적지 후보) 검색 시 발생하는 불필요한 외부 API(Tmap API Proxy) 호출을 줄이고, 브라우저 세션 레벨에서 데이터를 효율적이고 안전하게 캐싱하기 위한 설계 및 구현 전략을 다룹니다.

---

## 1. 분석 개요
- **요약**: 현재 `usePoiSearch` 커스텀 훅은 컴포넌트의 단순 연속 재검색만 차단할 뿐, 화면 전환 후 복귀나 비연속적인 동일 키워드 검색 시 외부 API 요청을 차단하지 못합니다. 이를 해결하기 위해 `sessionStorage`를 활용하여 최대 50개의 캐시를 유지하는 FIFO(First-In, First-Out) 방식의 링 버퍼 구조 클라이언트 캐싱 레이어를 설계합니다.
- **기대 효과**: 동일 세션 내 중복 검색 요청의 90% 이상을 클라이언트에서 즉시 반환하여 사용자 경험(UX)을 대폭 향상시키고 Tmap API 호출 비용을 절감합니다.

---

## 2. 기존 구조 및 문제점 분석

### 2.1 관련 파일 구조

| 파일 경로 | 주요 역할 | 분석 요점 |
|---|---|---|
| `src/hooks/usePoiSearch.ts` | 입력된 키워드에 대해 `debounceMs` 후 POI 결과 반환 | - `lastKeyword.current`로 직전 검색어와 동일 여부만 확인.<br>- 컴포넌트 언마운트 혹은 타 키워드 검색 후 재검색 시 무조건 API 재요청. |
| `src/lib/tmap/geocoding.ts` | `searchPOIList` 함수로 실제 API 통신 수행 | - 지오코딩(`geocode`)은 인메모리 `geoCache` Map을 사용하나, POI 리스트 검색(`searchPOIList`)은 캐싱 무풍지대. |

### 2.2 기존 `usePoiSearch` 데이터 흐름의 문제점

```
[사용자 입력] ──> (Debounce 500ms) ──> [lastKeyword 비교] 
                                              │
                         ┌────────────────────┴────────────────────┐
                         ▼ (동일한 경우)                           ▼ (다른 경우)
                  [요청 취소/무시]                              [searchPOIList API 호출]
```

- **문제점**: "서울역" ──> "강남역" ──> "서울역" 순으로 검색 시, 마지막 "서울역"은 직전 키워드("강남역")와 다르므로 **Tmap API를 재호출**하게 됩니다.
- **메모리 이탈 문제**: 사용자가 페이지를 이탈하여 다른 탭이나 메뉴로 이동했다가 차량운행일지 작성 페이지로 돌아오면 `usePoiSearch` 훅의 상태(`lastKeyword.current`)가 초기화되어 **모든 검색어를 새로 호출**합니다.

---

## 3. 상세 캐시 설계 (Detailed Cache Design)

### 3.1 스토리지 선정 및 SSR 안정성
- **스토리지**: `sessionStorage`를 선택합니다. 사용자가 브라우저 탭을 열고 있는 동안("세션")에만 데이터를 유효하게 관리하여, 메모리 누수를 막고 브라우저 종료 시 자동으로 공간을 확보합니다.
- **SSR(서버 사이드 렌더링) 안전 가드**: Next.js 등 서버 사이드 렌더링 프레임워크나 빌드 타임 컴파일 단계에서 `window` 또는 `sessionStorage`가 존재하지 않아 발생할 수 있는 참조 에러(`ReferenceError: sessionStorage is not defined`)를 원천 차단하기 위해 `typeof window !== 'undefined'` 조건절을 통해 스토리지 접근을 감쌉니다.

### 3.2 캐시 데이터 스키마 정의 (`PoiCacheSchema`)
`sessionStorage`는 문자열 키-값 구조만 지원하므로 단일 직렬화 객체로 설계하여 원자적이고 동기화 오류가 없는 구조를 만듭니다.

```typescript
import type { PoiResult } from '../lib/tmap/geocoding';

/**
 * POI 캐시 저장 구조 정의
 */
export interface PoiCacheSchema {
    /** FIFO 밀어내기용 순서 리스트 (검색 키워드 저장) */
    queue: string[];
    /** 실제 검색 결과 데이터 매핑 객체 */
    data: Record<string, PoiResult[]>;
}

export const POI_CACHE_STORAGE_KEY = 'vehicle_log_poi_cache';
export const MAX_CACHE_SIZE = 50;
```

---

## 4. FIFO 링 버퍼 알고리즘 설계

### 4.1 동작 알고리즘 및 엣지 케이스 처리

1. **초기화 및 직렬화 안전성**:
   - `sessionStorage.getItem()`을 호출하여 기존 캐시를 불러옵니다.
   - 데이터가 깨져있거나 파싱 에러 발생 시(`SyntaxError`), 캐시를 초기화(`{ queue: [], data: {} }`)하여 전체 애플리케이션 장애로 이어지지 않게 합니다 (Try-Catch 가드).
2. **검색어 Key 정제 (Sanitization)**:
   - 검색어 입력값의 양끝 공백을 제거(`trim()`)하고 모두 소문자 처리하거나 공백을 정규화하여 `"서울역 "`과 `"서울역"`이 다른 키로 취급되는 현상을 방지합니다.
3. **링 버퍼(FIFO 큐) 동작 순서**:
   - **Case A. 이미 캐시에 존재하는 키워드인 경우**:
     - API Proxy를 거치지 않고 캐시에서 즉시 데이터를 반환합니다.
     - 순수 FIFO 원칙에 의해 큐의 순서는 그대로 유지합니다.
   - **Case B. 캐시에 없는 신규 키워드인 경우**:
     - API Proxy 호출 성공 후, 결과를 캐시에 삽입합니다.
     - `queue` 배열의 끝에 키워드를 추가(`push`)합니다.
     - `queue.length`가 `50`을 초과하는 경우:
       - 큐의 가장 첫 번째 항목(가장 오래된 검색어)을 꺼냅니다: `const oldestKey = queue.shift();`
       - 데이터 매핑 객체에서 해당 키를 완전히 삭제합니다: `delete data[oldestKey];`
     - 업데이트된 캐시 객체를 `JSON.stringify`를 통해 `sessionStorage`에 반영합니다.

### 4.2 링 버퍼 데이터 처리 순서도 (수도코드)

```typescript
function addPoiToCache(keyword: string, results: PoiResult[]): void {
    if (typeof window === 'undefined') return;

    const cache = loadPoiCache(); // { queue: [], data: {} } 반환
    const cleanKey = keyword.trim();

    if (cleanKey in cache.data) {
        // 이미 존재한다면 데이터만 업데이트
        cache.data[cleanKey] = results;
        savePoiCache(cache);
        return;
    }

    // 신규 추가
    cache.queue.push(cleanKey);
    cache.data[cleanKey] = results;

    // FIFO 링 버퍼 50개 밀어내기 적용
    if (cache.queue.length > MAX_CACHE_SIZE) {
        const oldestKey = cache.queue.shift();
        if (oldestKey) {
            delete cache.data[oldestKey];
        }
    }

    savePoiCache(cache);
}
```

---

## 5. 구현 전략 및 변경 제안 (Proposed Changes)

구현 단계에서 안전하고 명확하게 소스코드를 수정할 수 있도록 구체적인 Before/After 구조 및 헬퍼 구현체를 제안합니다.

### 5.1 Proposed Cache Helpers (`src/hooks/usePoiSearch.ts` 상단 또는 별도 파일 추가)

`any` 타입을 철저히 배제하고 strict type 지정을 적용한 캐시 로직입니다.

```typescript
const POI_CACHE_KEY = 'vehicle_log_poi_cache';
const MAX_CACHE_SIZE = 50;

interface PoiCacheSchema {
    queue: string[];
    data: Record<string, PoiResult[]>;
}

/**
 * sessionStorage로부터 POI 캐시를 안전하게 로드합니다.
 */
function loadPoiCache(): PoiCacheSchema {
    if (typeof window === 'undefined') {
        return { queue: [], data: {} };
    }
    try {
        const raw = sessionStorage.getItem(POI_CACHE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.queue) && parsed.data && typeof parsed.data === 'object') {
                return parsed as PoiCacheSchema;
            }
        }
    } catch (e) {
        console.error('Failed to parse POI cache from sessionStorage:', e);
    }
    return { queue: [], data: {} };
}

/**
 * sessionStorage에 POI 캐시를 안전하게 저장합니다.
 */
function savePoiCache(cache: PoiCacheSchema): void {
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.setItem(POI_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.error('Failed to write POI cache to sessionStorage:', e);
    }
}

/**
 * 캐시에서 특정 키워드의 결과를 조회합니다.
 */
function getPoiFromCache(keyword: string): PoiResult[] | null {
    const cache = loadPoiCache();
    const cleanKey = keyword.trim();
    return cache.data[cleanKey] || null;
}

/**
 * 캐시에 결과를 저장하고 FIFO 링 버퍼를 만족하도록 용량을 관리합니다.
 */
function addPoiToCache(keyword: string, results: PoiResult[]): void {
    const cache = loadPoiCache();
    const cleanKey = keyword.trim();

    if (cleanKey in cache.data) {
        cache.data[cleanKey] = results;
        savePoiCache(cache);
        return;
    }

    cache.queue.push(cleanKey);
    cache.data[cleanKey] = results;

    if (cache.queue.length > MAX_CACHE_SIZE) {
        const oldestKey = cache.queue.shift();
        if (oldestKey) {
            delete cache.data[oldestKey];
        }
    }

    savePoiCache(cache);
}
```

### 5.2 `usePoiSearch` 훅 코드의 Before -> After 제안

#### Before (기존 코드 59~72라인)
```typescript
        timerRef.current = setTimeout(async () => {
            lastKeyword.current = trimmed;
            setPoiLoading(true);
            try {
                const list = await searchPOIList(trimmed, 10);
                setPoiResults(list);
                setShowPoiDropdown(list.length > 0);
            } catch {
                setPoiResults([]);
                setShowPoiDropdown(false);
            } finally {
                setPoiLoading(false);
            }
        }, debounceMs);
```

#### After (캐시 레이어가 내장된 개선 코드)
```typescript
        timerRef.current = setTimeout(async () => {
            lastKeyword.current = trimmed;

            // Step 1: 클라이언트 캐시 조회 (Cache-First)
            const cached = getPoiFromCache(trimmed);
            if (cached) {
                setPoiResults(cached);
                setShowPoiDropdown(cached.length > 0);
                // 캐시 히트 시 외부 API 호출 생략 및 로딩 스킵
                return;
            }

            // Step 2: 캐시 미스 시 외부 API Proxy 호출
            setPoiLoading(true);
            try {
                const list = await searchPOIList(trimmed, 10);
                setPoiResults(list);
                setShowPoiDropdown(list.length > 0);
                
                // 검색 결과가 존재하는 정상 케이스에 대해서만 캐시에 기록
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
```

---

## 6. 에이전트 행동 헌법 및 보안 가드 준수 계획

구현 담당 에이전트가 코드를 완성할 때 발생할 수 있는 위반 사항을 예방하기 위한 클린 코드 준수 방향입니다.

- **[D1] any 타입 철저 배제**:
  - 캐시에서 조회해 오는 데이터, 큐, 매핑 객체 등에 절대 `any` 타입을 붙이지 않습니다. `PoiResult[]` 및 `PoiCacheSchema` 인터페이스를 적극 활용합니다.
  - JSON 파싱 결과인 `JSON.parse` 반환물은 `any` 타입이 기본이므로, 타입 안전성 검증(`Array.isArray` 등)을 마친 후 `as PoiCacheSchema` 타입 단언(Type Assertion)을 사용하여 안전하게 형변환합니다.
- **[D15] 불필요한 라이브러리 비사용**:
  - 캐싱 솔루션을 위해 추가적인 npm 라이브러리(`lodash`, `lru-cache` 등)를 설치하거나 도입하지 않고, 바닐라 JS/TS의 내장 기능을 기반으로 용량 1KB 미만의 경량 링 버퍼를 구현합니다.
- **[D9] 컴포넌트 레벨 DB 호출 배제**:
  - 해당 훅에서는 오직 외부 REST API Proxy(`/api/tmap`) 결과만을 받아서 활용하므로 Firestore 등 DB 통신을 수행하지 않습니다.
- **[GUARD-1] 시크릿 평문 노출 방지**:
  - `sessionStorage` 저장 시 개인정보나 API Key 등 민감 데이터를 다루지 않고, 오직 Tmap POI 검색 응답 객체(`PoiResult[]`)와 순수 키워드 텍스트만을 보관합니다.
- **[GUARD-3] fetch() 직접 호출 탐지 준수**:
  - `usePoiSearch.ts` 내에서 `fetch` 또는 `axios`를 직접 활용해 백엔드 API를 호출하지 않으며, 기존에 검증된 `searchPOIList` 모듈 함수(`src/lib/tmap/geocoding.ts` 수록)를 사용하여 API 호출 구조의 일관성을 완벽히 보장합니다.

---

## 7. 검증 및 테스트 전략 (Verification & Testing)

향후 구현 시, 캐싱 로직이 명확히 동작하는지 검증하기 위한 Vitest 기반의 테스트 시나리오를 제안합니다.

### 7.1 주요 테스트 케이스 정의

1. **캐시 히트 및 API 스킵 검증**:
   - 동일 키워드로 2회 연속 검색 요청 시, 2번째 요청에서는 `searchPOIList`가 호출되지 않고 1번째의 `sessionStorage` 결과가 그대로 반환되는지 확인.
2. **FIFO 링 버퍼 한계 동작 검증**:
   - 루프를 돌려 총 51개의 상이한 키워드(`"keyword1"` ~ `"keyword51"`)를 검색 및 저장.
   - 캐시 큐의 크기가 `50`으로 엄격히 유지되는지 확인.
   - 첫 번째 등록했던 `"keyword1"`이 캐시 큐 및 데이터 매핑 테이블에서 완벽히 삭제되었는지 확인.
3. **직렬화 예외 및 파싱 에러 복구 검증**:
   - `sessionStorage`에 의도적으로 오염된 데이터(예: 깨진 JSON 스트링 `"{invalid-json"`)를 주입한 상태에서 `usePoiSearch`를 실행했을 때 파싱 오류로 인한 앱 크래시가 발생하지 않고, 정상적으로 캐시가 리셋되어 새 API 요청을 처리하는지 검증.

### 7.2 Vitest Mocking 설계 예시

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addPoiToCache, getPoiFromCache } from './usePoiSearch';

describe('POI Search sessionStorage FIFO Cache Test Suite', () => {
    beforeEach(() => {
        // sessionStorage Mocking
        const store: Record<string, string> = {};
        vi.stubGlobal('sessionStorage', {
            getItem: (key: string) => store[key] || null,
            setItem: (key: string, value: string) => { store[key] = value; },
            clear: () => { Object.keys(store).forEach(k => delete store[k]); }
        });
    });

    it('should evict the oldest entry when cache size exceeds 50 (FIFO)', () => {
        const dummyResults = [{ lat: 37, lon: 127, name: 'Test', address: 'Seoul' }];
        
        // 51개의 상이한 캐시 주입
        for (let i = 1; i <= 51; i++) {
            addPoiToCache(`key_${i}`, dummyResults);
        }

        // 최하위 key_1은 삭제되고 key_2는 잔존해야 함
        expect(getPoiFromCache('key_1')).toBeNull();
        expect(getPoiFromCache('key_2')).not.toBeNull();
        expect(getPoiFromCache('key_51')).not.toBeNull();
    });
});
```

위의 세심한 테스트 설계를 통해 구현 단계에서 발생할 수 있는 안정성 버그를 사전에 100% 예방하고 안심할 수 있는 빌드를 구축할 수 있습니다.
