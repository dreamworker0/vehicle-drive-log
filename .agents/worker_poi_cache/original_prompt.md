## 2026-05-29T08:49:45+09:00
당신은 차량운행일지 PWA 서비스의 POI 검색 캐싱 개선 과제(Milestone 1)를 직접 구현하는 Worker 에이전트입니다.
프로젝트 루트 디렉토리는 'd:\apps\차량운행일지'이며, 귀하의 전용 작업 폴더는 'd:\apps\차량운행일지\.agents\worker_poi_cache' 입니다.

[MANDATORY INTEGRITY WARNING]
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

[미션 및 상세 지침]
3인의 Explorer 에이전트가 도출한 최적의 종합 캐싱 설계를 완벽하게 구현하십시오.

1. **수정 대상 파일**: `src/hooks/usePoiSearch.ts`
2. **캐시 유틸리티 헬퍼 함수 구현**:
   - `sessionStorage` 기반 캐시 데이터 로드 및 저장 함수 구현.
   - 캐시 키: `poi_search_cache`
   - 구조: `{ queue: string[], data: Record<string, PoiResult[]> }` (strict type 지정, any 금지)
   - FIFO 링 버퍼 관리: 신규 키워드 삽입 시 큐의 크기가 50을 초과할 경우 가장 오래된 키워드(`queue.shift()`)와 이에 연동된 `data` 레코드 제거.
   - SSR 가드: `typeof window !== 'undefined'` 조건을 적용해 window/sessionStorage가 미정의된 환경의 에러 차단.
   - 예외 가드: JSON 파싱 에러 방지를 위해 try-catch 처리하고, 실패 시 `{ queue: [], data: {} }`로 안전 복구.
   - QuotaExceeded 가드: 스토리지 꽉 참 현상이나 쓰기 제한 에러 발생 시 catch하여 캐시를 완전히 리셋해 주는 안전장치 확보.
3. **usePoiSearch.ts 훅의 최적화 이식 (Debounce Bypass)**:
   - 사용자가 텍스트를 입력하여 훅의 `useEffect`가 동작할 때, Debounce 타이머(`setTimeout`)가 작동하기 전에 동기적으로 캐시를 먼저 조회(Cache-First).
   - **캐시 히트 시**: 500ms의 Debounce 지연을 우회(Bypass)하여 0ms 만에 드롭다운 결과(`setPoiResults`, `setShowPoiDropdown`)를 채우고 함수를 즉시 종료(`return`).
   - **캐시 미스 시**: 기존과 동일하게 Debounce 타이머를 돌려 외부 API Proxy(`searchPOIList`)를 호출하고, 결과가 유효하게 존재하는 정상 케이스에 대해서만 캐시에 새로 저장(`addPoiToCache`).
4. **품질 검증**:
   - 코드를 수정한 뒤, 프로젝트 루트에서 다음 명령어들을 차례로 수행하여 완벽한 빌드 및 정적 품질을 확인하십시오:
     - `npm run lint` (에러나 경고 없음)
     - `npx tsc --noEmit` (타입 체킹 에러 없음)
     - `npm run build` (빌드 정상 완료)
     - `npm test` 또는 관련 단위 테스트 구동
   - 필요 시 캐시 로직의 정상 동작과 50개 FIFO 만료를 테스트할 수 있는 단위 테스트를 추가하거나 기존 테스트 코드를 업데이트하여 품질을 입증하십시오.

[아웃풋]
- 구현 및 빌드 검증이 끝나면 귀하의 작업 디렉토리('d:\apps\차량운행일지\.agents\worker_poi_cache') 하위에 'handoff.md'를 작성하십시오.
- handoff.md 에는 변경 파일 상세, 수행한 검증 명령 및 결과(성공 텍스트/로그)를 명시해 주십시오.
- 완료 후 오케스트레이터(Recipient ID: 071173e3-1a57-4fc5-a8be-14ce1cc78207)에게 send_message 도구를 사용해 "Milestone 1 구현 및 빌드/품질 검증이 완료되었습니다. handoff.md를 확인하십시오."라고 보고하십시오.
