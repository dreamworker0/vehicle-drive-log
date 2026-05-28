## 2026-05-28T11:41:41Z

너는 E2E 및 기능 수정을 수행할 작업자 에이전트(teamwork_preview_worker)이다.
너의 임무는 프로젝트 루트 d:\apps\차량운행일지 에서 다음의 코드 수정 사항을 반영하고, 빌드 및 테스트 검증을 완료하는 것이다.

**MANDATORY INTEGRITY WARNING**:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

[구체적 수정 요구사항]

1. 프론트엔드 컴포넌트 접근성 보완:
- 파일 경로: d:\apps\차량운행일지\src\components\auth\OrgApplicationPage.tsx
- 수정 내용:
  - 이용약관 및 개인정보처리방침 체크박스에 명시적 ID(예: "agree-terms", "agree-privacy")를 부여하고, 그에 대응하는 label 태그에 htmlFor 속성을 지정하여 스크린 리더 및 접근성 진단을 성공시켜라.
  - hidden 처리된 파일 업로드 input 엘리먼트(type="file")에 id="nonprofit-document-upload" 와 aria-label="비영리 증빙서류 업로드" 속성을 부여해라.

2. E2E 테스트 코드 세션 격리 적용:
- 파일 경로: 
  - d:\apps\차량운행일지\e2e\org-application.spec.ts
  - d:\apps\차량운행일지\e2e\accessibility.spec.ts
- 수정 내용:
  - 각 테스트 파일의 beforeEach 블록에 `await context.clearCookies();` 및 `await context.clearPermissions();` 코드를 추가하여, 이전 테스트 세션(로그인 상태)이 누출되어 리다이렉션이 발생하거나 폼 필드가 readOnly가 되는 현상을 방지해라.
  - 만약 필요하다면, nameInput 및 emailInput 입력 전 `if (await input.isEditable())`과 같은 방어 코드 처리를 검토하고 반영해라.

3. 빌드 및 테스트 확인:
- 수정 완료 후, 터미널 명령을 통해 다음을 검증해라:
  1. tsc 타입 체크 및 전체 프로젝트 빌드: `npm run build`
  2. Playwright E2E 전체 테스트 실행: `npx playwright test`
- npx playwright test 실행 시 실패했던 6개의 테스트를 포함하여 총 69개의 모든 테스트가 에러 없이 100% 정상 통과(Passed)하는지 엄격히 확인해라.

[결과물 작성]
- 수정 내용과 수행한 빌드/테스트 결과를 d:\apps\차량운행일지\.agents\worker_m2_m3\changes.md 파일로 상세히 기록해라. (성공적인 테스트 통과 로그 포함)
- 작업이 정상 완료되면 handoff.md를 작성하고 호출자(Orchestrator)에게 완료 메시지를 발송해라.
