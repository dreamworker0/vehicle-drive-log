# Handoff Report — Milestone 1 (POI Cache Design)

이 핸드오프 보고서는 POI 검색 캐싱 개선 과제에 대한 Explorer 3 에이전트의 최종 분석 및 설계 결과를 담고 있습니다.

---

## 1. Observation (관찰 사항)

본 에이전트는 프로젝트 내 두 주요 파일의 코드를 직접 조회 및 분석하여 아래와 같은 구체적인 증거와 특징들을 확인했습니다.

### 1.1 `src/hooks/usePoiSearch.ts` 분석 (라인 38 ~ 77)
- **코드 상태**: `usePoiSearch` 훅은 `keyword`가 변경되면 디바운스(`debounceMs = 500`)를 거쳐 `useEffect` 내부에서 Tmap POI 목록을 호출합니다.
- **기존 중복 제어 로직 (라인 55)**:
  ```typescript
  // 같은 키워드 재검색 방지
  if (trimmed === lastKeyword.current) return;
  ```
  - `lastKeyword.current`는 단일 `useRef` 변수로 바로 직전 검색어만 보관하므로 비연속적인 동일 키워드 검색 시에는 재호출을 막지 못합니다.
  - 컴포넌트 이탈(언마운트) 후 재진입 시 상태가 초기화되어 불필요한 요청이 무조건 발생합니다.
- **API 호출 위치 (라인 63)**:
  ```typescript
  const list = await searchPOIList(trimmed, 10);
  ```
  - `searchPOIList` 헬퍼 함수에 10개의 데이터 한도를 전달하여 호출하고 있습니다.

### 1.2 `src/lib/tmap/geocoding.ts` 분석 (라인 39 ~ 67)
- **구조**: `searchPOIList` API 래퍼 함수는 `Tmap` Proxy API에 `/api/tmap` 주소로 요청하여 목적지 주소 리스트를 생성 및 정제해 `PoiResult[]` 포맷으로 반환합니다.
- **타입 정의 (라인 29 ~ 34)**:
  ```typescript
  export interface PoiResult {
      lat: number;
      lon: number;
      name: string;
      address: string;
  }
  ```
  - 검색 결과가 `PoiResult[]` 형태이므로 캐싱할 데이터 타입이 명확히 강제되어 있습니다.

---

## 2. Logic Chain (논리적 추론 과정)

1. **사용자 행동 유형**: 차량운행일지 작성 시 목적지를 입력하다 오타 수정, 혹은 기존에 쳤던 목적지로 복구하는 경우("서울역" ──> "서울역 인근" ──> "서울역") 및 동일 탭에서 여러 운행일지를 반복 입력하는 과정이 빈번합니다.
2. **API 호출 낭비 발생**: 기존 `lastKeyword.current`만으로는 "비연속 중복 검색"과 "컴포넌트 복귀 검색" 흐름에서 전혀 캐시 혜택을 볼 수 없어, 비싼 외부 Tmap API Proxy 호출이 무차별적으로 일어납니다.
3. **스토리지 선정**: 따라서 탭 세션 동안 수명이 보장되는 `sessionStorage`를 캐시 스토리지로 설정하면 동일 탭 안에서 화면을 이동하거나 복수 일지를 입력해도 검색 결과 캐시가 견고하게 영속화됩니다.
4. **용량 및 메모리 관리**: 캐시가 브라우저 세션에 제한 없이 무한정 축적될 경우 성능 및 메모리 저하가 우려되므로, FIFO 링 버퍼 알고리즘을 적용하여 큐의 크기가 `50`을 초과하는 즉시 가장 오래된 키와 데이터를 삭제하는 한계를 설정합니다.
5. **구조 최적화**: 큐 순서(`queue: string[]`)와 검색 결과 데이터(`data: Record<string, PoiResult[]>`)를 단일 스토리지 키(`vehicle_log_poi_cache`)로 직렬화하여 저장하면, 개별 쓰기/읽기 지연 및 비동기 불일치를 예방해 무결성이 극대화됩니다.

---

## 3. Caveats (주의 사항)

- **오프라인 동작**: 본 캐싱은 클라이언트 브라우저의 `sessionStorage`에 데이터를 담는 것으로, 네트워크 단절(오프라인 모드) 상태에서도 이미 검색했던 내역은 즉시 복귀하여 캐시 히트(Cache Hit)를 구현합니다. 그러나 신규 키워드(Cache Miss)에 대해서는 오프라인 시 API 에러가 나므로 정상 처리가 불가합니다.
- **동일 이름의 다중 세션**: `sessionStorage`는 탭별로 독립적이므로 브라우저 탭을 여러 개 열고 동시에 사용할 경우 탭 간 캐시는 공유되지 않습니다. 만약 탭 간 공유가 필수라면 `localStorage` 고려가 필요하나, 이 경우 수동 비우기나 만료 타임스탬프 관리가 복잡해져 오염의 여지가 커지므로 세션 스토리지가 가장 안전하고 설계 목적에 부합합니다.
- **용량 초과 한도**: 50개라는 상한선은 평균적인 POI 결과 데이터(`PoiResult` 10개 세트) 기준 약 50KB 수준으로, 브라우저가 제공하는 `sessionStorage` 용량 한도(5MB)의 1% 미만이므로 매우 안전합니다.

---

## 4. Conclusion (결론)

- `sessionStorage` 기반의 `PoiCacheSchema` 단일 직렬화 구조를 정의하여 영속성을 확보합니다.
- Pure TypeScript 구현을 통해 라이브러리 추가가 없도록 설계하여 번들 크기를 늘리지 않고 `D15`를 준수합니다.
- strict typing 기법을 사용하여 `any` 타입을 배제하고 가독성 높은 헬퍼 함수를 적용합니다.
- `usePoiSearch` 내의 비동기 `setTimeout` 로직 시작부에 캐시 검색 분기(Cache-First)를 삽입해 캐시 히트 시 외부 API 호출 비용을 0으로 차단합니다.
- 상세한 설계 코드 스케치는 동반 파일 `analysis.md`에 완벽하게 수록되었습니다.

---

## 5. Verification Method (검증 방법)

Implementer 에이전트가 본 설계를 바탕으로 코드를 수정한 후 다음 방법을 통해 완벽하게 검증할 수 있습니다.

### 5.1 브라우저 콘솔 수동 검증
1. 브라우저 개발자 도구(F12)의 Application -> Session Storage 탭을 활성화합니다.
2. 차량 목적지 검색 창에 `"서울역"`을 입력하여 드롭다운이 뜨는지 보고, 스토리지에 `vehicle_log_poi_cache` 키와 데이터(queue, data)가 직렬화되어 생성되는지 확인합니다.
3. 다른 키워드 `"강남역"`을 입력한 후, 다시 `"서울역"`을 입력했을 때 Network 탭에서 외부 Tmap API Proxy(/api/tmap) 호출이 발생하지 않고 즉시 드롭다운이 표시되는지 검증합니다.
4. 임의의 키워드 51개를 순서대로 반복 타이핑하여, 큐 배열의 크기가 50개에서 고정되고 맨 처음 입력했던 1번째 키워드가 완벽하게 삭제(FIFO 작동)되는지 확인합니다.

### 5.2 Vitest 자동화 단위 테스트
- `analysis.md` 7절에 수록된 Vitest 스크립트 모킹 코드를 활용하여 테스트 코드를 `src/hooks/__tests__/usePoiSearch.test.ts`에 추가한 뒤 다음 명령어를 수행해 테스트 성공 여부를 확인합니다:
  ```bash
  npm test
  ```
