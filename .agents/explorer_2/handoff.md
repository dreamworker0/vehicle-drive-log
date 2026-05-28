# Handoff Report — Auth-Form State Sync Investigation

## 1. Observation (관찰 사항)

인증 상태 변경과 폼 데이터 간의 정적/동적 불일치 현상에 대해 분석한 구체적 파일 코드 및 정황 데이터입니다.

- **`src/hooks/useOrgApplication.ts` 내 정적 Auth 참조**:
  - `Line 61`에서 리액트 상태가 아닌 일반 변수로 Firebase Auth의 인스턴스를 바로 가져옵니다.
    ```typescript
    61:     const currentUser = firebaseAuth.currentUser;
    ```
  - `Line 64~70`에서 이 정적 변수를 초기값으로 하는 `useState`를 선언하고 있습니다.
    ```typescript
    64:     const [form, setForm] = useState({
    65:         applicantName: currentUser?.displayName || '',
    66:         orgName: '',
    67:         applicantEmail: currentUser?.email || '',
    68:         applicantPhone: '',
    69:         message: '',
    70:     });
    ```

- **`src/components/auth/OrgApplicationPage.tsx` 내 이름 필드 `readOnly` 누락**:
  - `Line 87~90`에서 신청자의 이름 인풋은 일반적인 `input`으로 렌더링되며, 이메일 인풋과 달리 `readOnly`나 로그인 비활성화 스타일 클래스가 전혀 지정되지 않았습니다.
    ```typescript
    87:                             <input
    88:                                 type="text" name="applicantName" value={form.applicantName}
    89:                                 onChange={handleChange} className="input" placeholder="홍길동" required
    90:                                 autoFocus
    91:                             />
    ```

- **`src/hooks/useAuth.tsx` 내 반응형 `user` 제공 가능 여부**:
  - `useAuth()`는 `FirebaseUser | null` 상태인 `user`를 React State로서 컨텍스트를 통해 제공하고 있습니다.
    ```typescript
    13:     user: FirebaseUser | null;
    ...
    274: export function useAuth() {
    ```

---

## 2. Logic Chain (논리 체인)

1. **리렌더링 누락 ([Observation 1]에 근거)**:
   `firebaseAuth.currentUser`는 React 상태가 아니기 때문에, Firebase가 로컬 세션(IndexedDB)을 확인하고 비동기적으로 토큰을 로드하여 `currentUser`에 유저 정보를 채워 넣는 순간에도 `useOrgApplication` 훅은 상태 변화를 감지하지 못해 리렌더링되지 않습니다.

2. **초기값 동결 ([Observation 1]에 근거)**:
   `useState`는 최초 마운트 시에만 `currentUser?.displayName` 및 `currentUser?.email` 값을 초기값으로 받아들이므로, 비동기 로딩으로 나중에 로그인 유저가 채워지더라도 `form.applicantName`과 `form.applicantEmail`은 빈 문자열(`""`)로 동결되어 자동 입력이 실패합니다.

3. **인터페이스 계약 불이행 ([Observation 2], [PROJECT.md]에 근거)**:
   `PROJECT.md`에는 로그인 시 이름 필드 또한 `readOnly` 처리하고 자동 바인딩하라는 사양이 명시되어 있습니다. 그러나 UI 코드에서 `readOnly` 처리와 조건부 스타일링이 누락되어 있어, 계약 조건을 만족하지 못하는 상태입니다.

4. **해결의 일관성 ([Observation 3]에 근거)**:
   이미 프로젝트 내에 비동기 세션을 올바르게 감지 및 발행하고 있는 `useAuth()` 훅이 존재합니다. 따라서 이를 `useOrgApplication` 내부로 이식하고 `useEffect` 사이드 이펙트를 구성하면 Auth-Form 간의 동적 양방향 동기화 문제를 완벽하고 간결하게 해결할 수 있습니다.

---

## 3. Caveats (주의 사항)

- **익명 로그인과의 관계**:
  `useAuth.tsx` 내부 주석에 따르면 익명 사용자(`isAnonymous === true`)는 앱 라우팅에서 비로그인으로 취급되고 `useAuth`의 `user`에 `null`로 매핑됩니다. 따라서 본 개선안(useAuth의 user 구독) 하에서도 익명 로그인 유저는 올바르게 비로그인 상태로 판정되어 수동 입력을 허용하게 됩니다.
- **성능 영향**:
  `useEffect`를 통해 `user`를 감시하고 상태를 업데이트할 때, 무한 루프가 발생하지 않도록 의존성 배열에 `currentUser`와 `authLoading`만 지정해 정밀 제어해야 합니다.

---

## 4. Conclusion (결론)

- **핵심 원인**: Firebase Auth의 비동기 세션 로드가 React `useState` 초기화 시점보다 늦게 끝나기 때문에 초기값이 빈 값으로 설정되며, 상태로 관리되지 않는 정적 참조로 인해 리렌더링 및 폼 데이터 자동 입력이 누락되는 버그입니다.
- **해결 조치**: 
  1. `useOrgApplication.ts` 내에서 `useAuth()` 훅의 `user`와 `loading` 상태를 받아와 dynamic하게 바인딩합니다.
  2. `useEffect`를 추가하여 `authLoading`이 끝나고 `user`가 존재할 때 폼 값을 채워주고, 로그아웃 시 지워주는 반응형 상태 연동 장치를 구현합니다.
  3. `OrgApplicationPage.tsx` UI의 이름 필드에도 이메일 필드와 마찬가지로 `readOnly={!!currentUser?.displayName}` 및 비활성화 배경 클래스를 추가하여 인터페이스 규격을 완성합니다.

---

## 5. Verification Method (검증 방법)

- **독립 검증용 테스트 코드 추가**:
  - `src/__tests__/hooks/useOrgApplication.test.ts`에 `react-hooks-testing-library`를 이용하여 Auth 상태가 `null`에서 `User` 객체로 변경될 때 `form`의 `applicantName`과 `applicantEmail`이 자동으로 업데이트되는지 검증하는 비동기 훅 테스트 케이스를 생성하여 실행합니다.
  - 실행 명령: `npm test` 또는 `npx vitest run src/__tests__/hooks/useOrgApplication.test.ts`
- **수동 UI 검증**:
  - 개발 서버를 켜고 `/apply` 경로에 비로그인 상태로 진입하여 이름과 이메일 칸이 수동 입력 가능한지 확인합니다.
  - 이후 로그인을 진행한 채로 `/apply` 경로에 진입하여 이름과 이메일 칸에 로그인 유저 정보가 자동으로 채워지고 수정 불가능(`readOnly`)으로 렌더링되는지 확인합니다.
