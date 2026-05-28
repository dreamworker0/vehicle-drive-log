# Handoff Report — E2E Test Failure Analysis

## 1. 🔍 Observation (관찰 사항)
* **대상 E2E 테스트 및 소스**:
  - `e2e/accessibility.spec.ts` (접근성 검증)
  - `e2e/org-application.spec.ts` (기관 신청 플로우)
  - `src/components/auth/OrgApplicationPage.tsx` (신청 UI)
  - `src/hooks/useOrgApplication.ts` (신청 폼 로직 훅)
  - `src/components/auth/AuthGuard.tsx` (인증 처리 가드)
  - `src/App.tsx` (라우팅 제어)
* **특이 현상**: 
  - `org-application.spec.ts`의 `getByPlaceholder('홍길동')` 탐색 대기(`toBeVisible`) 및 `fill` 구문에서 10초 타임아웃 오류 발생.
  - `accessibility.spec.ts`의 `getByPlaceholder('홍길동')` 대기에서도 동일하게 10초 타임아웃 오류 발생.
  - `OrgApplicationPage.tsx` 89~90라인: 이름 인풋은 `readOnly={!!currentUser?.displayName}`으로 동적 설정됨.
  - `AuthGuard.tsx` 67~77라인: `requireGuest` 경로(루트 `/`) 진입 시 로그인 유저가 존재하면 대시보드로 자동 네비게이션 처리됨.

---

## 2. 🧠 Logic Chain (논리적 연결망)
1. **[관찰]** E2E 테스트 내에서 `/apply` 경로로 갈 때 또는 루트 `/`에서 버튼을 누르고 이동할 때 `getByPlaceholder('홍길동')`에서 10초 타임아웃이 발생하여 모든 테스트가 무너짐.
2. **[추론-A]** 테스트 실행 컨텍스트에 이전 테스트의 로그인 상태가 공유 및 잔존하고 있다면, 루트 `/` 진입 즉시 `AuthGuard`의 `requireGuest && user` 조건이 만족되면서 `/admin` 또는 `/employee` 등으로 자동 리다이렉트가 일어남. 따라서 `서비스 도입 신청` 버튼이 있는 랜딩페이지가 차단되어 `/apply` 페이지의 placeholder를 아예 스캔하지 못함.
3. **[추론-B]** `/apply`에 직접 도달하더라도 로그인된 계정(`currentUser`)의 정보(`displayName`, `email`)가 채워진 상태라면 이름 및 이메일 인풋이 `readOnly={true}` 상태가 됨. Playwright는 `readOnly` 필드에 `fill` 입력을 전송할 수 없으므로, 입력을 대기 및 시도하는 과정에서 결국 10초의 실행 타임아웃이 발생함.
4. **[결론]** 따라서 세션 상태에 관계없이 테스트가 작동하려면 테스트 실행 단위(`beforeEach`)에서 스토리지 및 쿠키 세션을 완전 클리어하여 게스트 상태를 담보하거나, 테스트 코드 상에서 `isEditable()` 조건 체크를 통하여 분기 처리를 해 주어야 함.

---

## 3. ⚠️ Caveats (주의 사항 및 제약)
* **제약조건**: 본 에이전트는 읽기 전용 탐색 에이전트(teamwork_preview_explorer)이므로, `/apply` 페이지의 실제 수정이나 Playwright 테스트 코드 변경을 직접 이행하지 않았습니다.
* **가정**: 로컬/CI 등 E2E 테스트 환경에서 Firebase Emulator 또는 실제 DB 세션의 로그인이 비동기적으로 유지되는 환경임을 전제하였습니다.

---

## 4. 🎯 Conclusion (결론)
이 E2E 및 접근성 테스트 실패는 비즈니스 폼의 유효성 검증 오류가 아니며, **테스트 환경의 로그인 세션 잔존으로 인한 리다이렉트 차단 및 `readOnly` 입력 불가능 상태에 기인한 순수 테스트 환경/구조의 결함**입니다. 
제안된 3가지 교정 방안(테스트 세션 강제 클리어, `isEditable` 분기, 체크박스/업로드 필드 웹 접근성 보완)을 적용함으로써 모든 에러를 해소할 수 있습니다.

---

## 5. 🧪 Verification Method (검증 방법)
* **검증 순서 및 명령어**:
  1. `e2e/org-application.spec.ts`와 `e2e/accessibility.spec.ts` 파일에 `test.beforeEach(async ({ context }) => { await context.clearCookies(); });` 구문을 추가합니다.
  2. Playwright E2E 테스트를 직접 로컬에서 실행합니다:
     ```bash
     npx playwright test e2e/org-application.spec.ts
     npx playwright test e2e/accessibility.spec.ts
     ```
  3. 모든 폼 입력 및 접근성 검증 케이스가 타임아웃 없이 성공적으로 통과(`Passed`)하는지 모니터링합니다.
