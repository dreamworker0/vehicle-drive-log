# POI 검색 캐싱 개선 과제(Milestone 1) 교차 검증 리뷰 보고서

## Review Summary

**Verdict**: REQUEST_CHANGES (수정 요청)

- **결론 요약**: 
  - `src/hooks/usePoiSearch.ts`의 구현부는 요구사항인 `sessionStorage` 기반 50개 FIFO 링 버퍼, Debounce Bypass (0ms 응답), QuotaExceededError/SyntaxError 예외 가드가 완벽하고 견고하게 처리되어 있습니다.
  - 하지만 추가된 단위 테스트 파일 `src/__tests__/hooks/usePoiSearch.test.ts`에서 **ESLint 린트 오류 3건**이 발생하였습니다. 이는 에이전트 행동 헌법(AGENTS.md)의 절대 금지 규칙 **D2 (any 타입 금지)** 및 **D3 (미사용 변수 금지)**를 명백히 위반한 사례입니다.
  - 따라서 테스트 코드의 품질 정밀 개선을 지시하기 위해 **REQUEST_CHANGES** 판정을 내립니다.

---

## Findings

### [Critical] Finding 1: 단위 테스트 파일 내 any 타입 사용 (D2 위반)
- **What**: TypeScript의 `any` 타입이 선언되어 명시적인 타입 추론을 저해하고 린트 오류를 발생시킵니다.
- **Where**: `src/__tests__/hooks/usePoiSearch.test.ts` (Line 7, Line 89)
- **Why**: 
  - 7라인: `(...args: any[]) => mockSearchPOIList(...args)`
  - 89라인: `const initialData: Record<string, any> = {};`
  - 에이전트 행동 헌법 **D2**는 `any` 타입 사용을 절대 금지하고 있으며, 린트 검사(`npm run lint`)에서 `@typescript-eslint/no-explicit-any` 에러가 발생하여 빌드 파이프라인의 완성도를 저해합니다.
- **Suggestion**:
  - `any[]` 대신 `unknown[]` 혹은 `Parameters<typeof searchPOIList>` 사용 권장.
  - `Record<string, any>` 대신 `Record<string, PoiResult[]>` 혹은 `Record<string, unknown>`과 같이 명확하고 구체적인 타입을 지정하십시오.

### [Major] Finding 2: 미사용 변수 선언 (D3 위반)
- **What**: 구조 분해 할당으로 꺼낸 변수가 한 번도 참조되지 않았습니다.
- **Where**: `src/__tests__/hooks/usePoiSearch.test.ts` (Line 107)
- **Why**: 
  - 107라인: `const { result } = renderHook(() => usePoiSearch('신규위치'));`
  - 여기서 `result` 변수가 반환되었으나 내부 테스트 스코프에서 사용되지 않고 있습니다. 이는 에이전트 행동 헌법 **D3**의 미사용 변수 금지 규칙을 위반하고, `@typescript-eslint/no-unused-vars` 린트 에러를 유발합니다.
- **Suggestion**:
  - 사용하지 않는 `result` 구조 분해 할당을 제거하고 `renderHook(() => usePoiSearch('신규위치'));`만 실행하도록 수정하십시오.

---

## Verified Claims

- **sessionStorage 기반 50개 FIFO 링 버퍼 작동** → verified via `src/__tests__/hooks/usePoiSearch.test.ts` 및 정적 코드 분석 → **PASS**
  - 캐시 추가 시 중복된 키워드를 앞서 제거하고 최신 큐 순서를 보장합니다.
  - 큐의 길이가 50을 초과하면 가장 오래된(선입) 데이터를 스토리지 및 메모리에서 명확하게 제거(shift)합니다.
- **Debounce Bypass (0ms 응답)** → verified via `src/__tests__/hooks/usePoiSearch.test.ts` (Line 67-84) → **PASS**
  - 캐시 히트 시 디바운스 타이머를 즉시 우회(Bypass)하여 0ms로 신속하게 동기적 결과를 렌더링하고 완료함을 독립적으로 검증하였습니다.
- **예외 가드 (SyntaxError, QuotaExceededError) 대응** → verified via `src/__tests__/hooks/usePoiSearch.test.ts` (Line 133-153) 및 정적 코드 분석 → **PASS**
  - JSON.parse 실패에 대한 `SyntaxError` 방어 가드가 구축되어 안전합니다.
  - QuotaExceededError 발생 시 캐시 데이터를 강제로 리셋(`removeItem`)하도록 에러 복구 처리가 안정적으로 적용되었습니다.
- **품질 검사 파이프라인 구동 결과**:
  - `npm run lint` → **FAIL** (위 3개 린트 에러 검출)
  - `npx tsc --noEmit` → **PASS**
  - `npm run build` → **PASS**
  - `npm run test` → **PASS** (전체 44개 테스트 파일, 311개 테스트 모두 성공 통과)

---

## Coverage Gaps

- **단위 테스트 내의 예외적 엣지 케이스 추가 검증 필요** — risk level: **LOW** — recommendation: **accept risk**
  - Tmap API 자체가 null을 반환하거나, 빈 배열을 반환할 때 캐싱하지 않고 스킵하는 요건은 `usePoiSearch.ts` 154라인(`if (list && list.length > 0)`)에 올바르게 적용되어 있으나 테스트 코드에서는 아직 이 세부 흐름에 대한 Assertions이 부족합니다. 다만 이는 보조적인 권장 사항이므로 현재 품질 위험도는 매우 낮습니다.

---

## Unverified Items

- **없음** (명령 파이프라인 및 소스 전수 조사를 완료하였음)

---

# Adversarial Review (공격 표면 및 예외 스트레스 테스트)

## Challenge Summary

**Overall risk assessment**: LOW (안정성이 전반적으로 높음)

## Challenges

### [Medium] Challenge 1: QuotaExceededError 발생 시 캐시 강제 리셋 이후의 동작 방식
- **Assumption challenged**: 브라우저 스토리지 크기가 임계치에 다다라 `setItem`이 예외를 발생시키면 `removeItem`을 통해 전체 데이터를 리셋하게 설계되었습니다.
- **Attack scenario**: 한 번 QuotaExceededError가 터진 직후, 그 다음 POI 검색 결과가 들어오면 다시 `setItem`을 호출하여 동일한 예외를 즉각적으로 무한 발생시킬 여지가 있습니다.
- **Blast radius**: 사용자 기기의 로컬 스토리지가 완전히 가득 찬 극단적인 상황이라면 매 검색마다 `setItem` -> `removeItem`이 연속 호출되어 에러 로그가 매 요청마다 도배되고 CPU 오버헤드가 누적될 위험이 존재합니다.
- **Mitigation**: 만약 `setItem`이 연속으로 계속 에러를 던진다면, 일정 시간 동안 캐시 쓰기를 일시 서스펜드(Suspend)하는 백오프(Backoff) 메커니즘을 두어 안전성을 보강할 것을 제안합니다.

---

## Stress Test Results

- **캐시 손상 및 SyntaxError 스트레스 테스트** → 로컬 스토리지에 손상된 JSON 문자열(`{invalid-json`) 강제 주입 후 usePoiSearch 호출 → `try-catch` 가드를 통해 예외를 삼키고 정상 무캐시 동작으로 무중단 폴백 확인 → **PASS**
- **QuotaExceededError 모킹 테스트** → 스토리지 풀 아웃 상황을 강제하여 setItem이 `Error: QuotaExceededError`를 던지게 함 → 리셋 처리 정상 작동 및 애플리케이션 비정상 중단 없음 검증 → **PASS**
