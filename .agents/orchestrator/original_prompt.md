# Original User Request

## Initial Request — 2026-05-28T20:39:21+09:00

당신은 이 프로젝트의 오케스트레이터(teamwork_preview_orchestrator)입니다.

현재 미션:
실패하는 Playwright E2E 테스트 6개를 분석하고 수정하여, 전체 테스트(npx playwright test)가 오류 없이 성공적으로 통과하도록 만듭니다.

세부 요구사항:
- R1. `/apply` (기관 사용 신청) 페이지 및 관련 기능 수정
  - Playwright 테스트에서 getByPlaceholder('홍길동') 등의 엘리먼트를 찾지 못하고 타임아웃이 발생하는 원인을 규명합니다.
  - `/apply` 페이지의 입력 필드 및 레이아웃이 정상적으로 렌더링되고, 필수 입력 검증 및 전화번호 자동 포맷 기능이 올바르게 동작하도록 수정합니다.
  - '돌아가기' 버튼 및 약관 동의 관련 기능이 정상 작동하는지 확인하고 수정합니다.
- R2. 테스트 코드 또는 컴포넌트 마크업 정합성 유지
  - 실제 프론트엔드 코드의 변경 사항이 있는 경우, 기존 접근성(Accessibility) 가이드라인 및 프로젝트 코딩 컨벤션을 준수합니다.
  - 필요시 테스트 코드의 셀렉터나 대기 시간을 합리적으로 조정하되, 기능의 본질적인 검증이 누락되지 않도록 합니다.
- 수락 기준(Acceptance Criteria):
  - npx playwright test 실행 시 실패했던 6개의 테스트를 포함하여 총 69개의 모든 테스트가 정상적으로 통과해야 합니다.
  - 특히 e2e/accessibility.spec.ts 및 e2e/org-application.spec.ts 내의 실패 케이스들이 모두 해결되어야 합니다.

지침 및 제약사항:
1. 절대 코드 수정이나 실행을 직접 임의로 판단해 대충 처리하지 말고, 탐색(Explorer), 작업(Worker), 리뷰(Reviewer) 등 필요한 에이전트를 적극 스폰하여 단계적으로 수행하십시오.
2. 모든 내부 사고 과정과 결과 보고는 한국어로 진행하십시오.
3. 작업 진행 상태를 `.agents/orchestrator/progress.md`에 정기적으로 기록하여 센티널이 모니터링할 수 있도록 하십시오.
4. 완료되면 '모든 마일스톤 완료'를 선언하며 센티널에게 보고하십시오. 센티널이 Victory Auditor를 구동해 최종 검증을 수행할 것입니다.
5. .agents/orchestrator 디렉토리를 작업 공간으로 사용하고, 이 안의 COORDINATION 및 PROGRESS 파일을 관리하십시오.
