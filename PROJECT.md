# Project: 실패하는 Playwright E2E 테스트 6개 수정 및 통과

## Architecture
- **Routing**: `src/App.tsx`에서 `/apply` 라우트의 비로그인 접근성 제어.
- **Form UI**: `src/components/auth/OrgApplicationPage.tsx`에서 신청서 UI 렌더링, 입력 필드 검증 및 포맷팅 처리.
- **Form State Hook**: `src/hooks/useOrgApplication.ts`에서 입력값 상태 관리 및 유효성 검증.
- **E2E Tests**: `e2e/org-application.spec.ts`, `e2e/accessibility.spec.ts` 등에서 `/apply` 페이지의 동작 및 접근성 검증.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | E2E 테스트 실패 원인 분석 | `accessibility.spec.ts` 및 `org-application.spec.ts` 실패 원인 규명 | none | IN_PROGRESS |
| 2 | `/apply` 페이지 기능 및 마크업 수정 | 필수값 검증, 전화번호 자동 포맷, 돌아가기 버튼, 약관 동의, 플레이스홀더 등 UI 결함 수정 | M1 | PLANNED |
| 3 | 접근성(Accessibility) 정합성 확보 | 폼 접근성 레이블, `aria-*` 속성 및 키보드 네비게이션 보완 | M2 | PLANNED |
| 4 | 전체 E2E 테스트 검증 및 통과 | npx playwright test 실행 시 69개 테스트 전체 성공 통과 및 정적 분석 완료 | M3 | PLANNED |

## Interface Contracts
- **OrgApplicationPage ↔ useOrgApplication**: 양방향 바인딩 및 유효성 검증 상태 관리.

## Code Layout
- `src/components/auth/OrgApplicationPage.tsx` — 도입 신청 페이지 컴포넌트
- `src/hooks/useOrgApplication.ts` — 도입 신청 비즈니스 로직 훅
- `e2e/org-application.spec.ts` — 도입 신청 E2E 테스트
- `e2e/accessibility.spec.ts` — 접근성 E2E 테스트
