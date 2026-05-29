# Handoff Report — POI Search Cache Analysis (Milestone 1)

이 문서는 POI 검색 시 클라이언트 레벨의 `sessionStorage` 기반 50개 제한 FIFO 링 버퍼 캐시 설계를 분석하고 도출한 뒤, 실제 구현을 담당할 Implementer 에이전트를 위해 작성된 5-Component 핸드오프 보고서입니다.

---

## 1. Observation (관측)

- **대상 파일 및 경로**:
  - `d:\apps\차량운행일지\src\hooks\usePoiSearch.ts` (총 81라인)
  - `d:\apps\차량운행일지\src\lib\tmap\geocoding.ts` (총 121라인)

- **핵심 소스 관측 (usePoiSearch.ts:57-76)**:
  ```typescript
  57:         if (timerRef.current) clearTimeout(timerRef.current);
  58: 
  59:         timerRef.current = setTimeout(async () => {
  60:             lastKeyword.current = trimmed;
  61:             setPoiLoading(true);
  62:             try {
  63:                 const list = await searchPOIList(trimmed, 10);
  64:                 setPoiResults(list);
  65:                 setShowPoiDropdown(list.length > 0);
  66:             } catch {
  67:                 setPoiResults([]);
  68:                 setShowPoiDropdown(false);
  69:             } finally {
  70:                 setPoiLoading(false);
  71:             }
  72:         }, debounceMs);
  ```

- **타입 정의 관측 (geocoding.ts:29-34)**:
  ```typescript
  export interface PoiResult {
      lat: number;
      lon: number;
      name: string;
      address: string;
  }
  ```

- **주요 팩트**:
  - 기존 `usePoiSearch` 훅은 `keyword`가 변할 때마다 `lastKeyword.current`와 단순 1:1 매칭 후 다르면 500ms의 `setTimeout` Debounce를 거쳐 매번 비동기 API 프록시인 `searchPOIList(trimmed, 10)`를 트리거하고 있습니다.
  - 별도의 세션 또는 로컬 캐시가 적용되어 있지 않아, 입력 도중 동일한 키워드로 재검색할 경우에도 Tmap API 네트워크 호출이 항시적으로 유발되고 있습니다.

---

## 2. Logic Chain (논리 체인)

1. **API 절약과 UX 속도 극대화의 필요성**: Tmap API는 외부 서비스로 호출 당 단가 혹은 일일 쿼터 제한이 존재하며, 모바일 PWA 환경에서 네트워크 레이턴시가 발생합니다.
2. **동일 키워드 검색의 캐시 필요성**: 사용자가 타이핑하는 동안 오타 수정 또는 지우고 다시 쓰는 과정에서 동일 키워드를 여러 번 입력하게 됩니다. 이를 클라이언트 단에서 가로채면 API 호출 횟수를 0으로 만들 수 있습니다.
3. **세션 캐시 스토리지의 선택**: 브라우저 세션이 활성화되어 있는 동안(사용자가 앱을 이용하는 도중)만 검색 결과를 유지하면 충분하므로, 메모리 영속성 보장과 세션 만료 시 자동 정리가 지원되는 `sessionStorage`가 캐시 매체로 가장 적합합니다.
4. **용량 및 메모리 보존을 위한 링 버퍼(FIFO)**: 캐시가 무한정 늘어날 경우 세션 스토리지 용량 초과(`QuotaExceededError`)가 일어날 수 있으므로, 크기를 50개로 제한해야 합니다. 이를 위해 선입선출(FIFO) 기반의 큐 배열(`queue`)과 실제 데이터 맵(`items`)을 동기화하여 오래된 캐시부터 밀어내는 링 버퍼 메커니즘을 설계합니다.
5. **Debounce 우회 설계**: 캐시가 이미 세션 스토리지에 존재할 경우에는 500ms의 Debounce 대기 없이 훅 호출 즉시 상태를 업데이트하여, 화면이 깜빡이지 않고 0ms에 가깝게 즉각적인 자동완성 드롭다운을 제공할 수 있습니다.

---

## 3. Caveats (주의사항)

- **멀티 탭 캐시 격리**: `sessionStorage`는 동일 오리진이라도 브라우저 탭 간에 공유되지 않습니다. 따라서 한 탭에서 검색한 이력이 다른 탭에 즉각 캐싱되지는 않습니다. (탭 간 공유가 필수적이라면 `localStorage`를 검토해야 하나, 메모리 누적 및 PWA 앱 종료 후의 정리를 감안하여 사용자 요구 사양인 `sessionStorage`로 설계가 고정되었습니다.)
- **검색 결과의 동적 변경 미반영**: POI 정보(예: 새로 개업한 가게 이름 등)가 실시간으로 변경되더라도 세션 동안은 캐시된 과거 데이터가 노출됩니다. 그러나 세션 스토리지의 생명주기는 브라우저 탭 종료 시 만료되므로 장기적인 데이터 불일치 가능성은 희박합니다.
- **에러 핸들링**: `JSON.parse` 시 스토리지 훼손 등으로 발생하는 구문 오류에 대처하기 위해 반드시 `try-catch` 구문이 래핑되어야 합니다.

---

## 4. Conclusion (결론)

- **결론적 설계 요건**:
  1. `PoiCacheData` 구조 (`{ queue: string[], items: Record<string, PoiResult[]> }`) 정의.
  2. 세션 스토리지를 다루는 `getPoiCache()` 및 `setPoiCache()` 캐시 유틸 함수 추가.
  3. `usePoiSearch` 훅의 `useEffect`에서 타이머 구동 전 `getPoiCache`를 통해 캐시 히트 여부를 검사.
  4. 히트 시: Debounce 타이머를 스킵하고 즉시 `setPoiResults` 및 `setShowPoiDropdown` 처리 후 얼리 리턴.
  5. 미스 시: 기존대로 Debounce를 태워 API 호출 후, 성공 시 `setPoiCache`를 호출하여 FIFO 규칙(50개 한도 초과 시 오래된 1개 제거)에 따라 캐시 추가.

---

## 5. Verification Method (검증 방법)

구현이 완료된 후, 다음 사항을 순차적으로 수행하여 올바르게 동작하는지 독립적으로 검증합니다:

1. **정적 타이핑 및 린트 검증**:
   - `npx tsc --noEmit` 실행 시 타입 가드 및 캐시 인터페이스 타입 에러가 없어야 함.
   - `npm run lint` 실행 시 D4(any), D5(unused variables) 린트 에러가 없어야 함.
2. **세션 스토리지 관찰**:
   - 브라우저 개발자 도구의 Application -> Session Storage 항목에서 `poi_search_cache` 키가 생성되고 JSON 데이터가 올바르게 갱신되는지 확인.
3. **네트워크 호출 생략 검증**:
   - 개발자 도구의 Network 탭에서 이미 검색한 단어 재검색 시 `/api/tmap` 쿼리가 발생하지 않고 UI 드롭다운이 0ms 대기시간으로 즉각 그려지는지 확인.
4. **FIFO 밀어내기 한도 검증**:
   - 51개의 고유 키워드로 검색을 수행하고 세션 스토리지 내 `queue` 배열 크기가 50개를 넘지 않고, 맨 처음 검색한 1번째 단어의 데이터가 성공적으로 지워졌는지 확인.
