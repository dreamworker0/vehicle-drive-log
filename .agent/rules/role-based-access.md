# 역할 기반 접근 권한 (RBAC) 검증 원칙

차량운행일지는 일반 '운전자'부터 렌트카 업체 성격인 '조직 관리자(최고관리자)'까지 섞여 있는 멀티테넌트(Multi-tenant) 성격의 앱입니다. 
보안과 UX 혼동을 막기 위해 모든 개발과 에이전트의 작업 시 다음 원칙을 따르세요.

## 핵심 규칙

### 1. 클라이언트(React) 상 노출 분리
- **슈퍼 관리자 / 조직 소유자 (Role: `admin`)**: 관리자 대시보드 접근 활성화, 멤버 승인/거절, 차량 데이터 삭제 등의 버튼이 렌더링 되어야 합니다.
- **일반 운전자 (Role: `driver`, `user`)**: 관리자 페이지 진입 버튼, 타인의 승인 내역, 설정 변경 탭은 보이지 않아야(hidden) 합니다.
- 컴포넌트 레벨에서는 `useAuth` 훅 등에서 권한 상태를 받아 **조건부 렌더링** (`{isAdmin && <AdminButton />}`) 으로 접근을 막습니다.

### 2. 백엔드(Firestore / Functions) 상 권한 검증 필수
- **프론트에서 버튼을 가렸다고 안전한 것이 아닙니다.** 누군가 API나 브라우저 콘솔에서 우회 요청할 수 있으므로, **Firebase Security Rules**와 **Cloud Functions** 내부 로직에서는 요청자의 UID가 `admin`인지 등급을 재확인해야 합니다.
- Cloud Function 코드 예시:
  ```typescript
  if (context.auth?.token.admin !== true) {
      throw new HttpsError("permission-denied", "관리자만 접근할 수 있습니다.");
  }
  ```

### 3. 방어적 코딩 (Defensive Coding)
- '권한이 없는 유저'가 해당 권한이 필요한 페이지 진입(직접 URL 타격 등) 시 에러 화면에서 무한 루프에 빠지거나 멈추지 않고, **"접근 권한이 없습니다"**라는 스낵바와 함께 메인 페이지(`/`)로 자연스럽게 리다이렉트(`useNavigate('/')`) 하도록 라우터 가드(Router Guard, 예: `ProtectedRoute.tsx`)를 세심하게 처리합니다.
