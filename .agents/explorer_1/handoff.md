# Handoff Report — Explorer 1

## 1. Observation (직접 관찰한 내용)

### 1.1 AuthGuard 설정
* **파일 경로**: `src/App.tsx`
* **라인**: 257
* **기존 코드**:
  ```tsx
  <Route path="/apply" element={<AuthGuard requireAuth><OrgApplicationPage /></AuthGuard>} />
  ```
* **파일 경로**: `src/components/auth/AuthGuard.tsx`
* **라인**: 58
* **코드 내용**:
  ```tsx
  export function AuthGuard({
    children,
    requireAuth = false,
  ```

### 1.2 이름 필드 및 이메일 필드 구현 방식 차이
* **파일 경로**: `src/components/auth/OrgApplicationPage.tsx`
* **라인**: 86~98
* **코드 내용**:
  ```tsx
  <div>
      <label className="label">이름 <span className="text-red-500">*</span></label>
      <input
          type="text" name="applicantName" value={form.applicantName}
          onChange={handleChange} className="input" placeholder="홍길동" required
          autoFocus
      />
  </div>
  <div>
      <label className="label">이메일 <span className="text-red-500">*</span></label>
      <input
          type="email" name="applicantEmail" value={form.applicantEmail}
          onChange={handleChange} className={`input ${currentUser?.email ? 'bg-surface-50 dark:bg-surface-800' : ''}`} readOnly={!!currentUser?.email}
          placeholder="example@email.com" required
      />
  </div>
  ```

### 1.3 useOrgApplication 훅 내부 폼 상태 초기값 설정
* **파일 경로**: `src/hooks/useOrgApplication.ts`
* **라인**: 61~70
* **코드 내용**:
  ```typescript
  const currentUser = firebaseAuth.currentUser;

  // 폼 상태
  const [form, setForm] = useState({
      applicantName: currentUser?.displayName || '',
      orgName: '',
      applicantEmail: currentUser?.email || '',
      applicantPhone: '',
      message: '',
  });
  ```

---

## 2. Logic Chain (논리적 추론 체인)

1. **로그인 가드 해제 추론**: 
   * `src/App.tsx:257`에서 `/apply` 경로에 `<AuthGuard requireAuth>`를 지정하여 비로그인 접근 시 로그인 페이지로의 리다이렉션이 발생합니다.
   * `AuthGuard.tsx:58`에서 `requireAuth` 속성의 기본값이 `false`로 정의되어 있습니다.
   * 따라서 `src/App.tsx`에서 `requireAuth` 프로퍼티를 제거하거나 `requireAuth={false}`로 명시하면 비로그인 사용자의 접근을 완전히 허용(가드 해제)할 수 있습니다.
2. **이름 필드 readOnly 누락 버그 추론**:
   * `OrgApplicationPage.tsx:96`에서 이메일 필드는 `currentUser?.email` 유무에 따라 `readOnly`와 배경색 클래스가 동적으로 바인딩되고 있습니다.
   * 반면 `OrgApplicationPage.tsx:86~90`에서 이름 필드는 이러한 속성 없이 일반 텍스트 필드로 제공되어 로그인 상태의 실명 바인딩임에도 사용자가 임의로 이름을 바꿀 수 있는 상태입니다.
   * 따라서 이름 필드에도 `readOnly={!!currentUser?.displayName}`와 `className={\`input \${currentUser?.displayName ? 'bg-surface-50 dark:bg-surface-800' : ''}\`}` 패턴을 통일되게 적용해야 마일스톤 2의 의도된 명세와 일치합니다.
3. **비동기 상태 초기화 연계**:
   * `useOrgApplication.ts:61`에서 초기 렌더링 시점에 `firebaseAuth.currentUser`를 가져와 `form` 상태의 초기값으로 집어넣고 있으나, Firebase 인증 비동기 처리가 지연될 시 빈 값으로 남는 잠재적인 결함이 존재합니다.
   * 따라서 후속 구현 에이전트는 훅 내부에 `currentUser`의 비동기 업데이트에 대응하여 `form` 상태를 갱신해주는 동기화 논리를 보완해야 합니다.

---

## 3. Caveats (주의 사항 및 한계점)

* **비로그인 사용자 이름 필드 포커스**: 이름 필드에는 `autoFocus` 속성이 지정되어 있습니다. 로그인한 사용자의 경우 `readOnly` 처리가 되므로 `autoFocus`가 해당 필드로 가도 입력이 불가능할 것입니다. 동작에 치명적이진 않으나 UX 관점에서 로그인 시 포커스 대상을 기관명(`orgName`) 필드로 동적으로 전환하게 조치하면 완벽할 것입니다.
* **익명 로그인/초대 연동 테스트**: 본 에이전트는 Read-Only로 조사를 진행했으므로, 실제 UI 테스트 시나리오 및 Cloud Functions의 백엔드 제출(`submitOrgApplication`) 시 비로그인 계정으로 작성된 데이터가 Firebase Firestore에 정상 삽입되는지 여부는 구현 에이전트(Implementer)가 환경을 테스트해야 합니다.

---

## 4. Conclusion (결론)

* `/apply` 라우팅 접근 제한은 `src/App.tsx` 내에서 `AuthGuard`의 `requireAuth` 속성을 제거하여 해결하는 것이 보안 유지상 가장 합당합니다.
* `OrgApplicationPage.tsx`의 이름 필드는 로그인한 유저의 `displayName`이 있을 경우 `readOnly`가 활성화되고 배경색이 바뀌도록 동적 바인딩 패치를 제안합니다.

---

## 5. Verification Method (독립적 검증 방법)

### 5.1 검사 대상 파일 및 변경점 확인
* **src/App.tsx**: `/apply` 경로에 `requireAuth` 속성이 제거되거나 `requireAuth={false}` 상태로 제공되는지 눈으로 확인합니다.
* **src/components/auth/OrgApplicationPage.tsx**: 이름 필드(`applicantName`)에 아래와 같은 동적 코드가 작성되었는지 검수합니다:
  ```tsx
  readOnly={!!currentUser?.displayName}
  className={`input ${currentUser?.displayName ? 'bg-surface-50 dark:bg-surface-800' : ''}`}
  ```

### 5.2 검증 명령 및 테스트
* 수정 작업 완료 후 다음 자동화 검증 루프를 구동합니다:
  ```bash
  # Step 1: ESLint 정적 분석 검사
  npm run lint
  
  # Step 2: TypeScript 타입 체크
  npx tsc --noEmit
  
  # Step 3: 훅 단위 테스트
  npm test src/__tests__/hooks/useOrgApplication.test.ts
  ```
