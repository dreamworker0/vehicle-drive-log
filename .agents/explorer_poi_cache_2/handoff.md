# Handoff Report — Explorer 2 (POI Search Cache)

본 보고서는 `d:\apps\차량운행일지` 프로젝트의 Milestone 1(POI 검색 캐싱 개선)에 대한 read-only 분석 인수인계서입니다.

---

## 1. Observation (관찰 사항)

본 에이전트는 아래 파일들과 소스 코드 구역을 확인하였으며, 관찰 결과는 다음과 같습니다:

1. **`src/hooks/usePoiSearch.ts` (1~81라인)**:
   - 라인 21: `export function usePoiSearch(keyword: string, debounceMs = 500)` 정의.
   - 라인 59~72: 디바운스 타이머가 실행되면 `searchPOIList`를 직접 비동기 호출함.
     ```typescript
     timerRef.current = setTimeout(async () => {
         lastKeyword.current = trimmed;
         setPoiLoading(true);
         try {
             const list = await searchPOIList(trimmed, 10);
             setPoiResults(list);
             setShowPoiDropdown(list.length > 0);
         } ...
     ```
   - 라인 54~55: `if (trimmed === lastKeyword.current) return;` 을 통한 단순 키워드 재검색만 방지하고 있으며, 훅 내부나 메모리상에 별도 캐시 자료구조가 전무함.

2. **`src/lib/tmap/geocoding.ts` (29~67라인)**:
   - 라인 29~34: `PoiResult` 인터페이스의 상세 스펙 관찰:
     ```typescript
     export interface PoiResult {
         lat: number;
         lon: number;
         name: string;
         address: string;
     }
     ```
   - 라인 39: `export const searchPOIList = async (keyword: string, count = 5): Promise<PoiResult[]>` 정의.
   - 라인 74~78: `geocode` 함수는 메모리 내의 `geoCache` Map을 통해 내부 캐싱을 수행 중이나, 드롭다운에 쓰이는 `searchPOIList`는 완전히 캐싱 없이 동작함.

---

## 2. Logic Chain (논리 체인)

1. **[Observation 1.1]** `usePoiSearch.ts` 내에서 사용자가 타자를 칠 때마다 디바운스 대기를 한 후 무조건 네트워크 요청(`searchPOIList`)을 생성합니다.
2. **[Observation 1.2]** Tmap API는 쿼리 건당 제한 및 프록시 호출 부담이 있으므로, 사용자가 한 번 검색했던 동일 단어(예: "강남역", "회사")를 여러 번 지웠다 다시 입력할 때 불필요한 네트워크 I/O 및 요금 부과가 유발됩니다.
3. **[Logic]** 이를 차단하기 위해 탭/브라우저 세션 생명주기 동안 데이터를 저장하는 `sessionStorage`에 검색 결과를 저장하여 0ms 만에 응답하도록 설계합니다.
4. **[Observation 2.1]** `PoiResult` 인터페이스 구조는 가볍고 단순한 JSON 직렬화가 가능하므로 `sessionStorage`에 최적입니다.
5. **[Logic]** 그러나 무제한 검색 데이터를 누적하면 세션 스토리지 용량 한계(`QuotaExceededError`)를 넘기거나 브라우저 성능 저하가 발생하므로, 최대 `50`개 한도의 FIFO(First-In, First-Out) 링 버퍼형 큐를 적용해 오래된 검색어 캐시는 자동으로 밀어내고 파기합니다.
6. **[Logic]** 입력 시 디바운스 딜레이(500ms) 전단계에서 동기적으로 캐시 유무를 검사(`getPoiCacheItem`)하게 하면, 캐시 히스토리가 있을 때 디바운스 시간을 아예 스킵하고 즉시 `setPoiResults`를 변경하여 혁신적인 UX 체감을 끌어낼 수 있습니다.

---

## 3. Caveats (주의 사항)

- **`sessionStorage` 용량 및 브라우저 비공개 모드**:
  - Safari의 시크릿 모드나 일부 브라우저 설정에 따라 `sessionStorage.setItem`이 차단되거나 용량이 극도로 작을 수 있습니다.
  - 따라서 `setItem` 블록은 반드시 `try-catch`로 감싸고, 실패 시 캐시 데이터를 초기화(`sessionStorage.removeItem`)하는 등의 예외 안정 장치(Fail-Safe)를 완벽히 구축해야 합니다.
- **동시성 탭 격리**:
  - `sessionStorage`는 탭별로 별도 격리되므로, 탭 간 POI 캐시를 동시 공유할 수는 없습니다. (오히려 동시성 경합 이슈가 원천 배제되므로 장점으로 작용함).
- **FIFO 링 버퍼 갱신 규칙**:
  - 링 버퍼 큐에서 중복되는 키워드를 다시 캐싱할 때, 맨 앞에 위치한 중복 데이터를 단순히 지우고 맨 뒤에 `push`함으로써 캐시 갱신(최신 생존 주기 부여)을 명확하게 처리해야 합니다.

---

## 4. Conclusion (결론)

- 본 Explorer 2는 `usePoiSearch.ts` 및 `geocoding.ts` 분석을 통해 **`sessionStorage` 기반 50개 FIFO 링 버퍼 캐시** 아키텍처 수립을 마쳤습니다.
- 유틸リティ 함수(`poiCache.ts`) 분리를 통해 캐시 관리 기능을 순수 함수 지향으로 격리하고, `usePoiSearch` 본문은 캐시 히트 시 디바운스를 우회하여 초고속 드롭다운을 렌더링하는 형태로 변경합니다.
- 이 설계는 AGENTS.md 및 보안 3대 가드를 한 치의 훼손 없이 준수하는 안전한 리팩토링의 핵심 이정표가 될 것입니다.

---

## 5. Verification Method (검증 방법)

구현 후, 아래 단계를 통해 캐싱의 정상 동작 여부를 검증할 수 있습니다:

1. **브라우저 개발자 도구 (Application 탭 -> Session Storage)**:
   - 검색창에 "서울역" 검색 후 드롭다운이 뜨면 `sessionStorage` 내 `'poi_search_cache'` 키 아래에 JSON 문자열로 캐시가 생성되었는지 검사.
   - 데이터 구조 검증: `[{ keyword: "서울역", results: [...], timestamp: 17... }]` 형태 확인.

2. **네트워크 호출 차단 검증 (Cache Hit)**:
   - "서울역"을 한 번 검색하여 캐시가 등록된 상태에서 검색어를 지웠다가 다시 "서울역"을 입력할 때:
     - 개발자 도구 Network 탭에서 `/api/tmap` 프록시 호출이 **일절 발생하지 않음**을 확인.
     - 로딩 스피너(`poiLoading`)가 깜빡이지 않고 **0ms만에 드롭다운 결과창이 팝업**됨을 확인.

3. **50개 한계 FIFO 링 버퍼 검증**:
   - 테스트 코드를 활용하거나 연속 검색을 통해 서로 다른 51개 키워드를 조회.
   - 캐시 개수가 최대 50개 이하로 상한 제어되는지, 그리고 51번째 단어가 입력될 때 가장 먼저 검색했었던 1번째 검색어 캐시가 큐에서 완전히 밀려나 파기되는지 확인.
