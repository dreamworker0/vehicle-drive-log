## 2026-05-28T09:38:35Z
d:\apps\차량운행일지\PROJECT.md 및 하위 익스플로러 분석 결과를 토대로, 비로그인 도입 신청 경로 허용 및 로그인 유무에 따른 동적 필드 렌더링/비동기 동기화 버그 해결을 위한 소스 코드 구현과 테스트 검증을 완수하십시오.

### 수정 및 추가할 주요 명세:
1. **라우팅 해제 (`src/App.tsx`)**:
   - `/apply` 경로의 `<AuthGuard requireAuth>`를 `<AuthGuard requireAuth={false}>`로 수정하여 비로그인 접근을 허용하되, 로그인 유저가 접속 시에는 가드 내부 보안 필터링을 타도록 아키텍처 수준을 유지합니다.

2. **이름 필드 readOnly 누락 버그 수정 (`src/components/auth/OrgApplicationPage.tsx`)**:
   - 이메일 필드와 페어링되도록 이름(`applicantName`) 필드도 로그인된 상태일 때 수정이 불가능하도록 readOnly 제약을 걸어주십시오.
   - 구체적으로 `readOnly={!!currentUser?.displayName}`(또는 `!!currentUser`) 속성을 추가하고, 비활성화 배경 스타일(`bg-surface-50 dark:bg-surface-800 text-surface-500`)을 조건부 적용하여 시각적 일관성을 맞추십시오.

3. **리액티브 비동기 세션 동기화 구현 (`src/hooks/useOrgApplication.ts`)**:
   - 정적인 `firebaseAuth.currentUser` 직접 조회를 제거하고, 공통 인증 훅인 `useAuth()`를 임포트하여 반응형 `{ user: currentUser, loading: authLoading }` 상태를 구독하십시오.
   - `useEffect` 감시 장치를 결합하여, `authLoading`이 완료된 시점에 `currentUser`가 있으면 `form` 상태의 `applicantName`과 `applicantEmail` 필드를 로그인 정보로 강제 동기화하고, 로그아웃 세션인 경우에는 빈 값(`''`)으로 초기화하여 비로그인 사용자가 자유롭게 입력할 수 있도록 폼을 클린업하는 동적 갱신 코드를 구현하십시오.

4. **테스트 코드 보강 (`src/__tests__/hooks/useOrgApplication.test.ts`)**:
   - 기존의 `formatPhoneNumber` 유틸리티 단위 테스트 외에, `useOrgApplication` 훅 자체를 렌더링 검증할 수 있도록 `@testing-library/react`의 `renderHook`과 `act`를 도입하고 외부 Firebase SDK 및 이미지 압축 라이브러리를 안전하게 목킹하여 통합 테스트를 구축하십시오.
   - 익스플로러 3가 설계한 11개의 입체적 시나리오(비로그인 마운트, 이미 로그인된 마운트, 비동기 로그인 로드 대응, 로그아웃 클린업, 입력 양방향 바인딩, 특정 영리 업종 차단 필터, 증빙 확장자/용량 초과 제한, 최종 Callable Functions 제출 API Payload 성공 및 한국어 에러 순화 검증 등)가 전부 포함되도록 완벽한 보강 테스트 코드를 작성하십시오.

5. **자체 코드 교정 및 빌드/테스트 검증 (Auto-Correction Loop)**:
   - 구현 완료 직후 다음 명령어들을 직접 실행하여 에러가 전혀 없음을 입증하십시오.
     - 정적 분석 검사: `npm run lint`
     - 타입스크립트 에러 검사: `npx tsc --noEmit`
     - 빌드 검사: `npm run build`
     - 테스트 성공 검사: `npm test` 또는 `npm test src/__tests__/hooks/useOrgApplication.test.ts` (모든 테스트가 그린 패스여야 함)
   - 만약 타입 오류나 린트 오류, 테스트 실패가 발견되면 최대 2회까지 스스로 코드를 자가 수정하여 검증 파이프라인을 통과시키십시오.

6. **MANDATORY INTEGRITY WARNING**:
   > DO NOT CHEAT. All implementations must be genuine. DO NOT
   > hardcode test results, create dummy/facade implementations, or
   > circumvent the intended task. A Forensic Auditor will independently
   > verify your work. Integrity violations WILL be detected and your
   > work WILL be rejected.

7. **보고**:
   - 완료 후 수정한 소스 코드 목록, 빌드 및 11개 테스트의 정상 통과 콘솔 출력 결과가 포함된 Handoff 리포트를 작업 디렉토리 `d:\apps\차량운행일지\.agents\worker_1\handoff.md` 에 기록하고 저에게 메시지를 보내주십시오.
   - 작업 디렉토리는 d:\apps\차량운행일지\.agents\worker_1\ 입니다.
