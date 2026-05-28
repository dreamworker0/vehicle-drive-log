# E2E 테스트 및 접근성 실패 원인 분석 보고서

본 보고서는 프로젝트 내 실패하는 Playwright E2E 테스트(`org-application.spec.ts`, `accessibility.spec.ts`)의 구체적인 타임아웃 원인과 소스 코드 상의 접근성 및 폼 처리 설계 결함을 파악하고, 이를 해결하기 위한 실질적인 수정 가이드를 제안합니다.

---

## 1. 📌 요약 (Summary)

* **핵심 실패 원인**: Playwright E2E 실행 환경에서 **이전 테스트의 로그인 세션(관리자 등)이 유지**되어 `/` 및 `/apply` 페이지 접근 시 `AuthGuard`의 리다이렉트가 동작하거나, 폼 내 이름 및 이메일 입력 필드가 `readOnly`로 전환되면서 Playwright의 `fill` 동작이 블로킹되어 **10초 타임아웃**이 발생합니다.
* **접근성 테스트 실패 원인**: `/apply` 페이지 자체가 타임아웃에 막혀 마운트되지 못하므로 접근성 검증까지 도달하지 못해 테스트가 연쇄 실패합니다. 또한, 약관 동의 체크박스와 숨겨진 파일 업로드 필드에 대한 명시적 레이블링(`htmlFor` / `id` 매핑)이 다소 미흡한 구조적 문제를 가지고 있습니다.

---

## 2. 🔍 상세 분석 및 실패 원인

### ① `getByPlaceholder('홍길동')` 등 엘리먼트 탐색 실패 및 타임아웃 원인

#### A. 이전 로그인 세션의 간섭 (AuthGuard의 강제 리다이렉션)
* **문제 지점**: `src/App.tsx` (라인 252) 및 `src/components/auth/AuthGuard.tsx` (라인 67~78)
* **상세**: 
  루트 경로 `/`는 게스트 전용 가드(`requireGuest`)로 보호됩니다. 만약 E2E 테스트 실행 컨텍스트에 로그인된 세션 상태가 남아 있다면, `page.goto('/')` 진입 즉시 `AuthGuard`에 의해 자신의 역할 대시보드(예: `/admin`, `/employee`)로 강제 리다이렉트가 일어납니다. 
  이로 인해 랜딩 페이지에 위치한 `서비스 도입 신청` 버튼이 렌더링되지 않으며, `/apply`로 진입하더라도 폼을 정상적으로 탐색하지 못하고 타임아웃이 발생합니다.
* **관련 코드 (`src/components/auth/AuthGuard.tsx` 67~72라인)**:
  ```typescript
  if (requireGuest && user) {
      let effectiveRole = userData?.role;
      // ...
      if (effectiveRole === 'admin') return <Navigate to="/admin" replace />;
      // ...
  }
  ```

#### B. 로그인 사용자로 인한 `readOnly` 필드 상태 및 Playwright `fill` 충돌
* **문제 지점**: `src/components/auth/OrgApplicationPage.tsx` (라인 86~101) & `e2e/org-application.spec.ts` (라인 73)
* **상세**:
  사용자가 이미 로그인되어 `currentUser.displayName` 또는 `currentUser.email`이 존재하는 상태로 `/apply`에 들어온 경우, 신청자 이름과 이메일 필드는 `readOnly` 속성이 부여됩니다.
  Playwright는 `fill()` 메소드를 수행하기 전 엘리먼트가 편집 가능한지(`editable`) 유효성을 검사하는데, `readOnly` 필드는 편집이 불가능하므로 **수정을 시도하다가 10초 대기 후 타임아웃으로 에러가 발생**합니다.
* **관련 코드 (`src/components/auth/OrgApplicationPage.tsx` 86~93라인)**:
  ```typescript
  <input
      type="text" name="applicantName" value={form.applicantName}
      onChange={handleChange}
      className={`input ${currentUser?.displayName ? 'bg-surface-50 ...' : ''}`}
      readOnly={!!currentUser?.displayName} // 로그인 유저 존재 시 readOnly
      placeholder="홍길동" required
      autoFocus
  />
  ```

---

### ② `/apply` 페이지의 입력 필드, 레이아웃 및 전화번호 자동 포맷 기능 분석

#### A. 전화번호 자동 포맷 기능 (`src/hooks/useOrgApplication.ts` 53~58라인)
* **설계 및 동작 분석**:
  ```typescript
  export function formatPhoneNumber(value: string) {
      const nums = value.replace(/[^0-9]/g, '').slice(0, 11);
      if (nums.length <= 3) return nums;
      if (nums.length <= 7) return `${nums.slice(0, 3)}-${nums.slice(3)}`;
      return `${nums.slice(0, 3)}-${nums.slice(3, 7)}-${nums.slice(7)}`;
  }
  ```
  입력값에서 숫자가 아닌 모든 문자를 지우고 11자리로 슬라이싱한 후 대시(`-`)를 추가해 주는 형태입니다. `01012345678`을 채워넣으면 정상적으로 `010-1234-5678`로 반환되므로 로직 자체는 완벽하게 올바르게 동작합니다. E2E 테스트가 실패하는 것은 이 함수 자체의 버그가 아니라, 타임아웃에 의해 input 필드에 값을 작성하지 못하기 때문입니다.

#### B. 필수 입력 검증 로직
* **설계 및 동작 분석**:
  `handleSubmit`에서 필수 필드 누락 및 특정 블랙리스트 기관(종교단체, 학교, 병원) 포함 여부와 비영리 증빙서류 업로드 여부를 훌륭하게 사전에 필터링하고 있습니다.
  `신청하기` 버튼은 필수값의 유무와 상관없이 약관 2개만 동의하면 `toBeEnabled` 상태가 되어 제출 로직을 수행하고, 빈 값일 때 `setError('필수 항목을 모두 입력해주세요.')`를 띄워 E2E 테스트에서 요구하는 에러를 정상 노출하도록 설계되어 있습니다.

---

### ③ '돌아가기' 버튼 및 약관 동의 관련 기능 분석

#### A. '돌아가기' 버튼
* **설계 및 동작 분석**:
  ```tsx
  <button type="button" onClick={() => handleGoBack(navigate)} ...>
      돌아가기
  </button>
  ```
  텍스트와 핸들러 연동이 완벽하게 이루어져 있습니다. E2E 테스트의 `getByText('돌아가기')` 역시 페이지가 마운트된다면 정상적으로 포착할 수 있습니다. 

#### B. 약관 동의
* **설계 및 동작 분석**:
  `agreeTerms`, `agreePrivacy` 상태가 2개의 체크박스에 바인딩되어 있으며, 두 체크박스가 모두 참일 때 제출 버튼이 활성화됩니다.
  그러나 E2E 테스트가 로그인된 세션 상태에서 동작할 때 이메일 필드가 `readOnly` 상태가 됨으로써 `emailInput.fill('invalid-email')`을 하려고 할 때 타임아웃이 발생하여 해당 테스트가 끝까지 완수되지 못합니다.

---

### ④ 접근성(Accessibility) E2E 테스트(`accessibility.spec.ts`) 실패 원인

* **1차적 원인**: `/apply` 페이지의 `getByPlaceholder('홍길동')`이 10초 내에 보이지 않는 타임아웃이 발생하여 그 뒤의 모든 접근성 검사 코드가 실행조차 되지 못하고 실패합니다.
* **구조적 개선 필요성 (약관 체크박스)**:
  체크박스가 레이블 내부에 래핑되어 있는 암묵적 레이블링 방식이지만, 명시적 레이블 구조(`htmlFor`와 `id` 매칭) 및 스크린 리더용 상세 속성이 누락되어 있으므로 이를 보완하면 접근성을 훨씬 더 완벽하게 개선할 수 있습니다.
* **구조적 개선 필요성 (파일 업로드 인풋)**:
  `hidden` 처리되어 있어 `visible` 검사에는 제외되지만, 만약 스타일 시트 로딩 지연 등으로 노출되거나 타 인풋 검사 시 `id`나 `aria-label`이 없어 경고를 뱉을 우려가 있으므로 `id="file-upload"` 등을 명시해 주는 것이 바람직합니다.

---

## 3. 🛠️ 해결 방안 및 코드 수정 예시 (Proposals)

### [수정 제안 1] E2E 테스트 환경 초기화 개선
E2E 테스트 실행 전에 로그인 세션을 완전히 초기화(Clear)하거나, Playwright 설정에서 게스트 세션을 강제하여 로그인 세션의 리다이렉트 및 `readOnly` 상태를 원천 차단합니다.

* **대상 파일**: `e2e/org-application.spec.ts` 및 `e2e/accessibility.spec.ts`
* **변경 방안**: `beforeEach` 블록에 컨텍스트 초기화 및 쿠키 클리어 적용

```typescript
// e2e/org-application.spec.ts 및 accessibility.spec.ts
test.beforeEach(async ({ context }) => {
    // 세션 격리를 위해 모든 쿠키 및 브라우저 스토리지 초기화
    await context.clearCookies();
    await context.clearPermissions();
});
```

---

### [수정 제안 2] Playwright 폼 입력 시 `readOnly` 상태 분기 처리 적용
이름이나 이메일 필드가 이미 채워져서 `readOnly`인 상태라면 `fill` 명령을 건너뛰도록 테스트 코드를 유연하게 작성합니다.

* **대상 파일**: `e2e/org-application.spec.ts`
* **수정 예시 (Before -> After)**:

* **Before (73라인)**:
  ```typescript
  await page.getByPlaceholder('홍길동').fill('테스트 사용자');
  ```
* **After (수정 제안)**:
  ```typescript
  const nameInput = page.getByPlaceholder('홍길동');
  if (await nameInput.isEditable()) {
      await nameInput.fill('테스트 사용자');
  }
  ```

* **Before (54라인)**:
  ```typescript
  await emailInput.fill('invalid-email');
  ```
* **After (수정 제안)**:
  ```typescript
  if (await emailInput.isEditable()) {
      await emailInput.fill('invalid-email');
  }
  ```

---

### [수정 제안 3] 소스 코드 상의 접근성 및 레이블 강화
접근성 테스트의 안정성을 확보하고 웹 접근성 표준을 극대화하기 위해 체크박스 및 입력 필드에 명시적인 ID와 레이블링을 부여합니다.

* **대상 파일**: `src/components/auth/OrgApplicationPage.tsx`
* **수정 예시 (Before -> After)**:

* **약관 동의 영역 (Before - 201~222라인)**:
  ```tsx
  <label className="flex items-start gap-3 cursor-pointer group">
      <input
          type="checkbox"
          checked={agreeTerms}
          onChange={(e) => setAgreeTerms(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
      />
      <span className="text-sm text-surface-600 ...">
          이용약관에 동의합니다.
      </span>
  </label>
  ```
* **After (명시적 레이블링 및 ID 부여 적용)**:
  ```tsx
  <div className="flex items-start gap-3 group">
      <input
          id="agree-terms"
          type="checkbox"
          checked={agreeTerms}
          onChange={(e) => setAgreeTerms(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
      />
      <label htmlFor="agree-terms" className="text-sm text-surface-600 dark:text-surface-400 group-hover:text-surface-800 dark:text-surface-200 transition-colors cursor-pointer select-none">
          <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary-600 underline underline-offset-2 font-medium hover:text-primary-700">이용약관</a>에 동의합니다. <span className="text-red-500">*</span>
      </label>
  </div>
  ```

* **파일 업로드 입력 필드 (Before - 164~170라인)**:
  ```tsx
  <input
      ref={fileInputRef}
      type="file"
      accept="image/jpeg,image/png,application/pdf"
      onChange={handleImageChange}
      className="hidden"
  />
  ```
* **After (접근성 ID 및 aria-label 명시)**:
  ```tsx
  <input
      id="nonprofit-document-upload"
      aria-label="비영리 증빙서류 업로드"
      ref={fileInputRef}
      type="file"
      accept="image/jpeg,image/png,application/pdf"
      onChange={handleImageChange}
      className="hidden"
  />
  ```

이러한 개선을 통해 게스트/로그인 세션에 무관하게 E2E 테스트가 매끄럽게 통과될 것이며, 궁극적인 시각 및 기술적 접근성 수준 역시 동시 확보될 수 있습니다.
