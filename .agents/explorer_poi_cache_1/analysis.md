# POI 검색 캐싱 개선 분석 및 설계 보고서 (Milestone 1)

본 보고서는 차량운행일지 PWA 서비스의 POI(목적지 장소) 검색 성능을 고도화하고, 외부 Tmap API 호출 비용을 획기적으로 절약하기 위해 클라이언트 레벨에서 `sessionStorage`를 활용한 50개 제한 FIFO 링 버퍼(Queue) 캐싱 메커니즘을 설계한 내용을 다룹니다.

---

## 1. 요약 (Summary)
- **핵심 목표**: 목적지 검색어(`keyword`)를 키로 삼아 `sessionStorage`에 POI 검색 결과(`PoiResult[]`)를 캐싱하여, 불필요한 API Proxy 네트워크 요청을 제거하고 입력 체감 속도를 즉각 반응(Debounce Bypass) 수준으로 단축합니다.
- **핵심 아키텍처**: 세션 동안 데이터를 유지하는 `sessionStorage` 내부에 단일 JSON 오브젝트로 `queue`(FIFO 관리 배열)와 `items`(결과 데이터 맵)를 구조화하고, 캐시 크기가 50개를 초과할 때 가장 오래된 검색어 캐시부터 자동 삭제하는 링 버퍼 방식으로 자원을 안전하게 통제합니다.

---

## 2. 기존 코드 분석

### 2.1 기존 `usePoiSearch.ts` 및 API 흐름
기존 훅은 사용자가 입력한 검색어(`keyword`)에 대해 다음과 같은 단계를 거쳐 POI 리스트를 검색합니다:

1. **입력 및 트리거**: `keyword`가 변경되면 `useEffect` 훅이 트리거됩니다.
2. **기본 검증**: 검색어 공백 제거 후 2자 미만이거나 Tmap API 사용 불가(`!isTmapAvailable()`) 상태이면 즉시 빈 배열을 세팅하고 함수를 종료합니다.
3. **동일 키워드 방지**: `trimmed === lastKeyword.current` 비교를 통해 컴포넌트 렌더링에 의한 불필요한 연속 호출을 1차적으로 방지합니다.
4. **Debounce 타이머**: 기존에 등록된 `timerRef`를 클리어하고 `debounceMs = 500`ms 이후 비동기 함수 `searchPOIList(trimmed, 10)`를 실행시킵니다.
5. **결과 처리**: 비동기 호출 성공 시 `poiResults` 상태를 업데이트하고 드롭다운을 활성화(`showPoiDropdown(true)`)합니다.

### 2.2 기존 구조의 문제점 및 비효율성
- **네트워크 비용 낭비**: 사용자가 이전에 검색했던 단어(예: "서울역")를 지웠다가 다시 입력하거나, 드롭다운을 닫은 뒤 재검색할 때 동일한 비동기 API 요청이 매번 다시 전송됩니다. Tmap API 쿼터는 제한적이므로 이는 직접적인 비용 유발 요인입니다.
- **입력 피드백 지연**: 캐시가 전혀 없기 때문에, 이미 검색해 본 검색어임에도 사용자는 강제로 500ms의 Debounce 대기 및 네트워크 지연(평균 100~300ms)을 감내해야 하므로 반응 속도가 느리게 느껴집니다.

---

## 3. 상세 캐싱 아키텍처 설계

클라이언트 사이드 브라우저 환경에서 안정적인 캐싱과 메모리 관리를 수행하기 위해 아래와 같이 **sessionStorage 기반 FIFO 링 버퍼 캐시**를 구성합니다.

### 3.1 캐시 데이터 구조 (Typescript 타입 정의)
`any` 타입을 철저히 배제(AGENTS.md D4 준수)하기 위해 명확한 타입 인터페이스를 선언합니다.

```typescript
import type { PoiResult } from '../lib/tmap/geocoding';

/**
 * sessionStorage에 저장될 캐시 루트 오브젝트 구조
 */
export interface PoiCacheData {
    queue: string[];                    // FIFO 순서가 보장되는 고유 검색어(키) 배열
    items: Record<string, PoiResult[]>; // 검색어별 POI 검색 결과 맵
}
```

### 3.2 FIFO 링 버퍼 (자동 밀어내기 50개 제한) 알고리즘
- **저장소 키**: `poi_search_cache`
- **최대 캐시 크기**: `50`개
- **동작 원리**:
  1. 새 키워드와 결과가 등록될 때, 해당 키워드가 기존 캐시(`items`)에 **존재하지 않는 신규 키워드**인 경우에 한해 `queue` 배열의 끝에 추가(`push`)합니다.
  2. 만약 `queue.length`가 `50`을 초과하게 되면, 큐의 가장 앞에 있는 가장 오래된 키워드(`queue.shift()`)를 제거합니다.
  3. 제거된 키워드에 해당하는 캐시 엔트리를 `items` 맵에서 완전히 삭제(`delete items[oldestKey]`)하여 메모리를 반환합니다.
  4. 기존 캐시에 **이미 존재했던 키워드**라면, 큐를 조작하지 않고 데이터(`items[keyword]`)만 최신 값으로 업데이트합니다. (순수한 FIFO 보장)

### 3.3 캐시 유틸리티 헬퍼 함수 구현안

이 로직은 훅 파일 내부의 private 헬퍼 함수로 캡슐화하거나, `src/lib/tmap/cache.ts`와 같이 분리하여 모듈화할 수 있습니다. 훅 자체의 응집도를 유지하기 위해 아래와 같이 구현 설계합니다.

```typescript
const CACHE_KEY = 'poi_search_cache';
const MAX_CACHE_SIZE = 50;

/**
 * 세션 스토리지에서 POI 캐시 데이터를 안전하게 파싱하여 반환합니다.
 */
function getPoiCache(): PoiCacheData {
    try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
            const parsed = JSON.parse(cached);
            // 런타임 데이터 구조 안정성 검증
            if (Array.isArray(parsed?.queue) && parsed?.items && typeof parsed.items === 'object') {
                return parsed as PoiCacheData;
            }
        }
    } catch (e) {
        console.error('POI cache read error:', e);
    }
    return { queue: [], items: {} };
}

/**
 * 세션 스토리지에 새 POI 결과를 캐싱하고, 50개 초과 시 오래된 캐시를 링 버퍼 형식으로 밀어냅니다.
 */
function setPoiCache(keyword: string, results: PoiResult[]): void {
    try {
        const cache = getPoiCache();
        const trimmed = keyword.trim();
        if (!trimmed) return;

        if (cache.items[trimmed]) {
            // 이미 캐시에 존재하는 검색어라면 결과만 최신화 (FIFO 순서는 보존)
            cache.items[trimmed] = results;
        } else {
            // 신규 검색어 등록
            cache.queue.push(trimmed);
            cache.items[trimmed] = results;

            // FIFO 링 버퍼 동작: 50개 초과분 제거
            while (cache.queue.length > MAX_CACHE_SIZE) {
                const oldestKey = cache.queue.shift();
                if (oldestKey) {
                    delete cache.items[oldestKey];
                }
            }
        }

        sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.error('POI cache write error:', e);
    }
}
```

---

## 4. `usePoiSearch` 훅 개선 구현 전략

동일한 키워드로 재검색할 때 API Proxy 요청을 완벽히 차단하고 즉각적인 피드백을 주는 통합 흐름입니다.

### 4.1 구현 코드 비교 (Before & After)

#### [Before] 기존 로직
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

#### [After] 캐싱 레이어가 반영된 개선 로직
```typescript
// [캐시 히트 체크] Debounce 타이머 구동 전에 세션 스토리지 조회를 먼저 수행합니다.
const cache = getPoiCache();
if (cache.items[trimmed]) {
    // 캐시 적중 시: Debounce 딜레이(500ms) 및 API 네트워크 요청을 생략하고 즉시 결과를 반영
    lastKeyword.current = trimmed;
    setPoiResults(cache.items[trimmed]);
    setShowPoiDropdown(cache.items[trimmed].length > 0);
    return;
}

// [캐시 미스 시] 기존 Debounce 및 네트워크 호출 로직 수행
timerRef.current = setTimeout(async () => {
    lastKeyword.current = trimmed;
    setPoiLoading(true);
    try {
        const list = await searchPOIList(trimmed, 10);
        setPoiResults(list);
        setShowPoiDropdown(list.length > 0);
        
        // 검색 결과를 세션 캐시 링 버퍼에 추가
        setPoiCache(trimmed, list);
    } catch {
        setPoiResults([]);
        setShowPoiDropdown(false);
    } finally {
        setPoiLoading(false);
    }
}, debounceMs);
```

### 4.2 캐싱 적용의 기대 효과
1. **네트워크 트래픽 격감**: 사용자가 한 번이라도 검색했던 장소는 세션 동안 다시 검색해도 API Proxy 및 Tmap API 서버로 가는 쿼리가 0건이 되므로 리소스 비용이 급격히 저하됩니다.
2. **UI 체감 반응 시간 0ms 달성**: 캐시 히트 시 500ms Debounce 지연을 우회하여 사용자가 텍스트를 완성하는 순간(또는 삭제 시 원래 키워드로 돌아오는 순간) 즉시 캐시 결과가 드롭다운에 노출되므로 초고속 피드백이 제공됩니다.
3. **오프라인 탄력성 확보**: 브라우저 오프라인 모드에서도 세션 캐시에 남아있는 검색 정보에 한해 POI 자동완성이 원활하게 작동하여 PWA의 모바일 오프라인 사용자 경험을 유지합니다.

---

## 5. 헌법 준수 및 품질 보증 (AGENTS.md & 가이드라인)

### 5.1 에이전트 행동 헌법 (AGENTS.md) 준수 여부
- **D1~D3 (window.confirm/alert/prompt 사용 금지)**: 캐시 파싱이나 스토리지 한도 초과 오류 발생 시 UI 메시지 창을 띄우지 않고, 안전하게 `try-catch`로 묶어 `console.error` 로깅 및 빈 상태 객체로 대응(Graceful Degradation)합니다.
- **D4 (any 타입 금지)**: JSON 파싱 결과에 대해 `PoiCacheData` 타입 단언 및 데이터 내부의 타입 구조 유효성 검증(`Array.isArray(parsed?.queue)`)을 추가하여 안전한 데이터 바인딩을 구현했습니다.
- **D5 (미사용 변수/import 금지)**: 구현 코드 제안 시 `PoiResult` 타입 이외에 불필요한 import나 선언만 해두고 쓰지 않는 변수가 없도록 최적화 설계를 준수했습니다.
- **D9 (컴포넌트 내 직접 Firestore 호출 금지)**: 본 아키텍처는 브라우저 내부 `sessionStorage`만을 이용하며, Firestore DB 쿼리와 무관하므로 설계 준수를 완벽하게 보장합니다.

### 5.2 보안 3대 가드 준수 여부
- **[GUARD-1] 시크릿 평문 탐지**: Tmap API 호출에 쓰이는 키 및 Proxy 설정 정보는 본 캐시 설계 및 코드 제안 어디에도 하드코딩되지 않으며, 기존의 안전한 환경 변수 접근 방식을 온전히 사용합니다.
- **[GUARD-2] 배포 전 검증 강제**: 구현 완료 후 배포 전에는 반드시 `npm run lint`와 `npx tsc --noEmit`을 통과하도록 가이드를 명시합니다.
- **[GUARD-3] fetch() 직접 호출 탐지**: 캐싱 레이어 도입은 기존의 `searchPOIList` 함수(내부적으로 `fetchTmap`을 사용)의 반환 데이터를 캐싱할 뿐, 훅 안에서 `fetch()`나 `axios()`를 직접 호출하지 않습니다.

---

## 6. 검증 및 테스트 계획

구현 후 설계를 검증하기 위한 구체적 시나리오 및 명령 목록입니다.

### 6.1 수동 검증 시나리오
1. **최초 검색 및 캐싱 확인**:
   - 브라우저 개발자 도구(F12)의 Application -> Session Storage 탭을 활성화합니다.
   - 검색창에 "강남역"을 입력하고 결과를 기다립니다.
   - `poi_search_cache` 키가 생성되고 `queue: ["강남역"]`과 해당 POI 리스트 결과가 저장되었는지 관찰합니다.
2. **캐시 히트 및 네트워크 차단 검증**:
   - 개발자 도구의 Network 탭을 켜고, 입력창을 지웠다가 다시 "강남역"을 입력합니다.
   - Network 탭에 `/api/tmap` 관련 호출이 새로 발생하지 않고, 즉시 드롭다운이 채워지는지 확인합니다.
3. **50개 FIFO 링 버퍼 임계치 검증**:
   - 콘솔창 또는 테스트 환경에서 `setPoiCache`를 반복 호출하여 51개의 상이한 키워드를 입력시킵니다.
   - `poi_search_cache` 내부의 `queue`의 원소 수가 50개를 유지하는지 확인하고, 첫 번째로 들어갔던 가장 오래된 키워드와 해당 데이터가 `items` 맵에서 안전하게 삭제되었는지 확인합니다.
4. **비정상 데이터 복구 검증**:
   - `sessionStorage`의 `poi_search_cache` 값을 깨진 문자열이나 임의의 객체(`{ invalid: true }`)로 훼손시킵니다.
   - 그 상태에서 새로 POI 검색을 수행했을 때 앱이 크래시되지 않고 에러 로깅 후 캐시가 초기화(`{ queue: [], items: {} }`)되어 정상 동작하는지 테스트합니다.

### 6.2 자동화 검증 명령어
코드 수정이 완료된 후 다음 명령어를 실행하여 빌드 오류 및 린트 경고가 없는지 확인합니다.
```bash
# 1. 린트 정적 검사
npm run lint

# 2. 타입스크립트 타입 체크
npx tsc --noEmit
```
