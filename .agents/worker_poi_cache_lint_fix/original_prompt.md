## 2026-05-28T23:53:52Z

당신은 차량운행일지 PWA 서비스의 POI 검색 캐싱 개선 과제(Milestone 1) 중, 단위 테스트 코드의 린트 및 타입 에러를 수정하여 최종 정적 검증을 통과시키는 Worker 에이전트입니다.
프로젝트 루트 디렉토리는 'd:\apps\차량운행일지'이며, 귀하의 전용 작업 폴더는 'd:\apps\차량운행일지\.agents\worker_poi_cache_lint_fix' 입니다.

[MANDATORY INTEGRITY WARNING]
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

[배경 및 에러 현황]
이전 이터레이션에서 POI 캐싱의 핵심 로직(sessionStorage FIFO 50 링 버퍼, Debounce Bypass 등)은 완벽하게 구현되어 5개 단위 테스트가 모두 통과하였습니다. 그러나 최종 Forensic Audit 및 Reviewer 교차 검증 중, 신규 작성된 테스트 코드('src/__tests__/hooks/usePoiSearch.test.ts') 내에서 ESLint 규칙 위반 3건이 검출되어 빌드가 차단되었습니다.

* 검출된 ESLint 에러:
  1. `7:30` - Unexpected any. Specify a different type. (@typescript-eslint/no-explicit-any)
  2. `89:43` - Unexpected any. Specify a different type. (@typescript-eslint/no-explicit-any)
  3. `107:17` - 'result' is assigned a value but never used. (@typescript-eslint/no-unused-vars)

[수정 및 구현 지침]
귀하는 'src/__tests__/hooks/usePoiSearch.test.ts' 파일의 린트 에러를 다음과 같이 완벽히 치유해야 합니다:

1. **타입 임포트**:
   - 파일 상단에 `import type { PoiResult } from '../../hooks/usePoiSearch';`를 추가하십시오.
2. **첫 번째 any 에러 해결 (라인 7 부근)**:
   ```typescript
   searchPOIList: (...args: any[]) => mockSearchPOIList(...args),
   ```
   이 mock 함수 선언을 실제 geocoding 모듈의 searchPOIList 시그니처에 맞추어 any를 완전히 배제하도록 수정하십시오:
   ```typescript
   searchPOIList: (keyword: string, limit?: number) => mockSearchPOIList(keyword, limit),
   ```
3. **두 번째 any 에러 해결 (라인 89 부근)**:
   ```typescript
   const initialData: Record<string, any> = {};
   ```
   이 부분을 임포트한 PoiResult를 사용하여 any를 제거하십시오:
   ```typescript
   const initialData: Record<string, PoiResult[]> = {};
   ```
4. **미사용 변수 에러 해결 (라인 107 부근)**:
   ```typescript
   const { result } = renderHook(() => usePoiSearch('신규위치'));
   ```
   구조분해 할당에서 미사용 변수인 `result`를 제거하고, 다음과 같이 훅만 호출하도록 변경하십시오:
   ```typescript
   renderHook(() => usePoiSearch('신규위치'));
   ```

[품질 검증 파이프라인]
수정을 마친 뒤, 프로젝트 루트('d:\apps\차량운행일지')에서 다음 품질 검사 명령을 실행해 모든 단계가 100% 에러/경고 없이 통과함을 반드시 입증하십시오:
1. `npm run lint` (에러나 경고 0건 필수)
2. `npx tsc --noEmit` (타입 컴파일 패스 필수)
3. `npm run build` (프로덕션 빌드 성공 필수)
4. `npx vitest run src/__tests__/hooks/usePoiSearch.test.ts` (모든 단위 테스트 통과 필수)

[아웃풋 요구사항]
- 모든 작업과 검증이 끝나면 귀하의 전용 작업 폴더('d:\apps\차량운행일지\.agents\worker_poi_cache_lint_fix')에 'handoff.md'를 작성하십시오.
- handoff.md 에는 수정한 파일 목록, 린트/빌드/테스트 실행 결과 로그를 성실하고 상세히 기재해야 합니다.
- 작업 완료 후, 오케스트레이터(Recipient ID: 071173e3-1a57-4fc5-a8be-14ce1cc78207)에게 send_message 도구를 통해 "단위 테스트 코드의 린트 및 타입 에러 수정 작업을 성실히 완료했으며, 린트/타입/빌드/테스트를 모두 패스하였습니다. handoff.md를 확인하십시오."라고 메시지를 보낸 후 대기하십시오.
