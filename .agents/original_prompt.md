## 2026-05-28T09:36:31Z

# Goal
비로그인 상태에서 서비스 도입 신청(/apply) 시 로그인 페이지로 강제 리다이렉트되는 라우팅 가드 버그를 해결합니다.

Working directory: d:\apps\차량운행일지
Integrity mode: development

## Requirements

### R1. `/apply` 경로의 로그인 필수 제한(requireAuth) 해제
- `src/App.tsx`에서 `/apply` 라우트의 `AuthGuard` 설정을 수정하거나 제거하여, 비로그인 사용자도 서비스 도입 신청 페이지 (`OrgApplicationPage`)에 바로 접근할 수 있도록 조치해야 합니다.

### R2. 로그인 유무에 따른 동적 필드 렌더링 검증
- 신청 양식 페이지에서 현재 로그인된 사용자가 있을 때는 이메일/이름이 자동으로 채워지고 읽기 전용 상태가 유지되는 반면, 로그아웃 상태(비로그인 상태)일 때는 이메일과 이름을 수동으로 입력할 수 있는지 코드가 정상 동작하는지 점검해야 합니다.

## Acceptance Criteria

### 라우팅 및 접근성
- [ ] 로그아웃 상태에서 `/apply` 주소로 직접 브라우저 접근 시 로그인 페이지로 리다이렉트되지 않고 신청 화면이 로드된다.
- [ ] 메인 화면(LandingPage)에서 "서비스 도입 신청" 버튼 클릭 시 `/apply` 페이지로 정상 이동한다.
- [ ] 신청 폼 제출 시 비로그인 사용자용 익명 제출 API(`submitOrgApplication`)가 정상 동작하여 신청이 완료된다.

## 2026-05-28T20:38:52+09:00

실패하는 Playwright E2E 테스트 6개를 분석하고 수정하여, 전체 테스트(npx playwright test)가 오류 없이 성공적으로 통과하도록 만듭니다.

Working directory: d:\apps\차량운행일지
Integrity mode: development

## Requirements

### R1. `/apply` (기관 사용 신청) 페이지 및 관련 기능 수정
- Playwright 테스트에서 getByPlaceholder('홍길동') 등의 엘리먼트를 찾지 못하고 타임아웃이 발생하는 원인을 규명합니다.
- `/apply` 페이지의 입력 필드 및 레이아웃이 정상적으로 렌더링되고, 필수 입력 검증 및 전화번호 자동 포맷 기능이 올바르게 동작하도록 수정합니다.
- '돌아가기' 버튼 및 약관 동의 관련 기능이 정상 작동하는지 확인하고 수정합니다.

### R2. 테스트 코드 또는 컴포넌트 마크업 정합성 유지
- 실제 프론트엔드 코드의 변경 사항이 있는 경우, 기존 접근성(Accessibility) 가이드라인 및 프로젝트 코딩 컨벤션을 준수합니다.
- 필요시 테스트 코드의 셀렉터나 대기 시간을 합리적으로 조정하되, 기능의 본질적인 검증이 누락되지 않도록 합니다.

## Acceptance Criteria

### E2E 테스트 통과
- [ ] npx playwright test 실행 시 실패했던 6개의 테스트를 포함하여 총 69개의 모든 테스트가 정상적으로 통과해야 합니다.
- [ ] 특히 e2e/accessibility.spec.ts 및 e2e/org-application.spec.ts 내의 실패 케이스들이 모두 해결되어야 합니다.
