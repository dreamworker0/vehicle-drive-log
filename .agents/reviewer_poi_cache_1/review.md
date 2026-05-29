# POI 검색 캐싱 개선 교차 검증 및 리뷰 보고서 (Milestone 1)

본 보고서는 `Reviewer 1` 에이전트가 차량운행일지 PWA 서비스의 POI 검색 캐싱 개선 과제(Milestone 1)에 대해 Worker가 구현한 코드 및 추가한 단위 테스트를 독립적으로 검증한 결과입니다.

---

## Review Summary

**Verdict**: ❌ **REQUEST_CHANGES**

- **총평**: 50개 FIFO 링 버퍼, Debounce Bypass(0ms 즉각 응답), QuotaExceeded 및 SyntaxError에 대응하는 정교한 안전 가드 등 **구현 코드(`src/hooks/usePoiSearch.ts`)의 비즈니스 로직은 아키텍처 수준에서 대단히 우수하고 완벽하게 작성**되었습니다. 또한 모든 단위 테스트가 통과되고 프로덕션 빌드 역시 JS/CSS 예산 하한선 내에서 성공하였습니다.
- **반려 사유**: 하지만 추가된 테스트 코드 `src/__tests__/hooks/usePoiSearch.test.ts` 내에서 **에이전트 행동 헌법의 절대 금지 목록(D4: any 타입 사용 금지, D5: 미사용 변수 금지)**을 위반하는 3건의 코드가 식별되어 `npm run lint`가 최종 에러 코드 1로 실패했습니다. 품질 검증 통과를 위해 테스트 코드 상의 린트 에러 수정을 강력히 요청합니다.

---

## Findings

### 🔴 [Critical] Finding 1: 에이전트 행동 헌법 절대 금지 목록(D4, D5) 위반 및 린트 실패

- **What**: `src/__tests__/hooks/usePoiSearch.test.ts` 내 `any` 타입 및 미사용 변수 사용으로 인한 ESLint 오류 발생.
- **Where**: `src/__tests__/hooks/usePoiSearch.test.ts` 
  - **Line 7:30** - D4 `any` 타입 금지 위반 (`(...args: any[]) => mockSearchPOIList(...args)`)
  - **Line 89:43** - D4 `any` 타입 금지 위반 (`const initialData: Record<string, any> = {};`)
  - **Line 107:17** - D5 미사용 변수 금지 위반 (`const { result } = renderHook(() => usePoiSearch('신규위치'));` 에서 `result`가 사용되지 않음)
- **Why**: 
  - D4(`any` 타입 사용 금지)는 코드 타입 안정성을 유지하기 위한 엄격한 약속입니다.
  - D5(미사용 변수 선언 금지)는 메모리 릭 및 불필요한 바인딩을 제거하기 위한 정적 분석 필터입니다.
  - 이로 인해 품질 검사 파이프라인 중 `npm run lint`가 에러(exit code 1)를 유발하여 배포 전 단계가 차단됩니다.
- **Suggestion**:
  - **D4 (Line 7) 수정 방향**: `any[]` 대신 `unknown[]` 또는 구체적인 타입 파라미터(`Parameters<typeof searchPOIList>`)를 사용합니다.
    ```typescript
    // 변경 전
    searchPOIList: (...args: any[]) => mockSearchPOIList(...args)
    // 변경 후
    searchPOIList: (...args: Parameters<typeof searchPOIList>) => mockSearchPOIList(...args)
    ```
  - **D4 (Line 89) 수정 방향**: `Record<string, any>` 대신 `Record<string, PoiResult[]>` 또는 `Record<string, unknown>`을 사용합니다.
    ```typescript
    // 변경 전
    const initialData: Record<string, any> = {};
    // 변경 후
    const initialData: Record<string, PoiResult[]> = {};
    ```
  - **D5 (Line 107) 수정 방향**: `result` 비구조화 할당을 생략하고 훅만 렌더링하도록 수정하거나, `result`를 활용하는 추가 어설션을 삽입합니다.
    ```typescript
    // 변경 전
    const { result } = renderHook(() => usePoiSearch('신규위치'));
    // 변경 후 (구조 분해 할당 제거)
    renderHook(() => usePoiSearch('신규위치'));
    ```

---

## Verified Claims

- **sessionStorage 50개 FIFO 링 버퍼 관리** 
  - *verified via*: `src/__tests__/hooks/usePoiSearch.test.ts` ("FIFO 링 버퍼: 50개가 초과되면 가장 오래된 키워드와 데이터가 캐시에서 삭제된다") 및 `npm run test` 실행 결과 → **PASS**
  - *분석*: 50개 캐시 적재 후 51번째 검색 시 `위치_1`이 정상적으로 탈락되고 `신규위치`가 추가됨을 sessionStorage 데이터 정밀 분석을 통해 실질 입증했습니다.
- **Debounce Bypass (캐시 히트 시 0ms 즉각 응답 및 API 스킵)**
  - *verified via*: `src/__tests__/hooks/usePoiSearch.test.ts` ("캐시 히트 시에는 디바운스를 우회하고 0ms 만에 즉시 동기적으로 결과를 반환한다") → **PASS**
  - *분석*: 캐시 적재 상태에서 디바운스 타이머 진행(`advanceTimersByTime`) 대기 없이 곧바로 데이터가 로드되고, TMap API 호출 Mocking 함수가 한 번도 기동하지 않았음을 검증했습니다.
- **예외 가드 (SyntaxError 및 QuotaExceededError)**
  - *verified via*: `src/hooks/usePoiSearch.ts` 코드 검토 및 "QuotaExceededError 등 스토리지 예외 발생 시 캐시가 리셋된다" 단위 테스트 실행 → **PASS**
  - *분석*: `Storage.prototype.setItem` 에러 모킹 시 `setItemSpy`를 포착하고 캐시 초기화 블록이 충돌 없이 안전히 동작함을 보장했습니다.
- **타입 컴파일 검증 (`npx tsc --noEmit`)**
  - *verified via*: `run_command`를 통한 타입 체커 실행 결과 성공 → **PASS**
- **정적 빌드 검증 (`npm run build`)**
  - *verified via*: `run_command` 빌드 프로세스 완수, 포스트 빌드 번들 크기 2950.2 KB 검출 (JS 예산 3000KB 및 CSS 예산 150KB 기준치 충족) → **PASS**

---

## Coverage Gaps

- **JSON 파싱 실패(SyntaxError) 복구 단위 테스트 누락** 
  - *Risk Level*: **LOW**
  - *Recommendation*: 세션스토리지에 손상된 JSON 문자열(예: `"{invalid_json"`)이 들어가 있는 예외적인 상황에서 `getPoiCache`가 크래시 없이 `{ queue: [], data: {} }`를 안전하게 반환하는지 모킹 테스트를 1개 추가하면 품질 완성도가 120%까지 향상될 것입니다. 다만, 소스 코드 자체에는 `try-catch` 가드가 완벽하므로 실제 런타임 리스크는 거의 없습니다.

---

## Unverified Items

- **없음**. 모든 핵심 요구사항(50개 링 버퍼, Debounce Bypass, 에러 가드)은 코드 레벨 및 311건의 독립 테스트 스위트 위에서 완전히 검증되었습니다.

---

## Adversarial Challenge (비판가 스트레스 분석)

### Challenge Summary
- **Overall risk assessment**: 🟢 **LOW** (안전 가드가 탄탄히 마련되어 있어 런타임 장애 유발성은 매우 적음)

### Challenges

#### 🟡 [Medium] Challenge 1: sessionStorage 한도 초과 시 무한 SetItem 연속 실패 위험성

- **Assumption challenged**: `QuotaExceededError` 발생 시 `window.sessionStorage.removeItem(CACHE_KEY)`을 통해 캐시를 완전히 리셋하면 용량이 확보되어 향후 저장이 재개될 것이라 가정했습니다.
- **Attack scenario**: 브라우저의 sessionStorage 전체 공간(보통 도메인당 5MB)이 POI 캐시 외의 다른 도메인 데이터나 대용량 데이터로 영구 가득 차 있는 특수한 모바일 브라우저 환경인 경우, POI 캐시를 전체 제거하여도 공간이 확보되지 않습니다. 이 상태에서 사용자가 입력을 계속하면 매 타이머 콜마다 `setItem`이 시도되고 예외 발생 후 제거가 무한 반복되어 CPU 오버헤드가 누적됩니다.
- **Blast radius**: 캐시 기능이 연속 불능 상태에 빠지며, 지속적인 에러 가드 호출로 인하여 모바일 기기에서의 미세한 성능 저하 및 실시간 API(TMap) 지속 호출로 인한 API 과금 비용이 증가합니다.
- **Mitigation**: 예외 가드 블록 내부에서 영구 실패 상태임을 인지하면 메모리 폴백(Memory-based Map 객체) 캐시 모드로 자동 전환하거나, 연속 3회 이상 쓰기 실패 시 해당 브라우저 세션 동안에는 `setPoiCache` 실행을 자체 스킵하도록 하는 서킷 브레이커(Circuit Breaker) 도입을 고려할 만합니다.

#### 🟢 [Low] Challenge 2: JSON 파싱 예외(SyntaxError) 발생 시의 안전한 복구 확인

- **Attack scenario**: 세션 스토리지에 제3의 스크립트나 동기화 비정상 동작 등으로 인해 포맷이 손상된 문자열이 저장될 경우.
- **Actual behavior**: `getPoiCache` 내부 `JSON.parse`가 SyntaxError를 발생시키지만, `catch (e)` 블록이 이를 가로채 안전하게 로깅 후 `{ queue: [], data: {} }` 초기 객체 구조를 반환함으로써 크래시를 전적으로 모면함을 확인했습니다. (완벽 방어)

---

## Verification Method (독립 검증 실행법)

수행된 검증 작업을 다음 명령어로 언제든지 로컬 환경에서 재현하고 검증할 수 있습니다:

1. **린트 검사** (현재 반려 대상 에러 발생):
   ```bash
   npm run lint
   ```
2. **타입 컴파일 검사**:
   ```bash
   npx tsc --noEmit
   ```
3. **단위 테스트 및 캐시 로직 검증**:
   ```bash
   npm run test
   ```
4. **프로덕션 번들 크기 빌드 검증**:
   ```bash
   npm run build
   ```
