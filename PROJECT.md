# Project: 비로그인 도입 신청(/apply) 허용 및 폼 유효성 버그 해결

## Architecture
- **Routing**: `src/App.tsx`에서 `react-router-dom`의 `<Route>` 및 커스텀 `<AuthGuard>`를 통해 권한별 화면 접근을 제어합니다.
- **Form UI**: `src/components/auth/OrgApplicationPage.tsx`에서 도입 신청서를 작성하는 UI를 구성하며, 로그인 유무에 따라 필드의 읽기 전용 여부와 배경 스타일이 유동적으로 바뀝니다.
- **Form State Hook**: `src/hooks/useOrgApplication.ts`에서 입력 상태(`form`)와 이미지 검증/압축을 수행하며, 최종 승인서 제출을 위해 서버리스 함수를 연계합니다.
- **Backend API**: `functions/src/submitOrgApplication.ts` (Cloud Functions)는 익명 상태의 가입 신청서 정보와 고유번호증/사업자등록증 이미지(Base64)를 업로드하고 Firestore에 기록합니다.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | App.tsx 라우팅 제한 해제 | `/apply` 라우트의 AuthGuard requireAuth 제거 및 비로그인 접근 검증 | none | DONE |
| 2 | 폼 이름 필드 readOnly 버그 해결 | 로그인 상태일 때 이름도 readOnly 처리 및 비로그인일 때 수동 입력 가능 확인 | M1 | DONE |
| 3 | useOrgApplication 훅 개선 | Firebase Auth 비동기 상태 변경 감지 대응 및 form 정보 초기화 보완 | M2 | DONE |
| 4 | 테스트 코드 및 정적 분석 검증 | `useOrgApplication.test.ts` 및 정적 분석(ESLint/tsc) 통과 확인 | M3 | DONE |

## Interface Contracts
### `OrgApplicationPage` ↔ `useOrgApplication`
- **applicantName**: 로그인 시 `displayName` 자동 바인딩 및 readOnly 처리. 비로그인 시 수동 입력값 양방향 바인딩.
- **applicantEmail**: 로그인 시 `email` 자동 바인딩 및 readOnly 처리. 비로그인 시 수동 입력값 양방향 바인딩.

### `useOrgApplication` ↔ `submitOrgApplication` (Cloud Function)
- **Input Payload**: `{ orgName, applicantName, applicantEmail, applicantPhone, message, imageBase64, imageMimeType }`
- **Output Response**: `{ success: boolean, orgId: string, uniqueNumberImageUrl: string }`

## Code Layout
- `src/App.tsx` — 전체 라우팅
- `src/components/auth/OrgApplicationPage.tsx` — 신청서 UI
- `src/hooks/useOrgApplication.ts` — 신청서 비즈니스 훅
- `src/__tests__/hooks/useOrgApplication.test.ts` — 훅 단위 테스트
