import { ReactNode, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { SA_TEST_ROLE_KEY } from '../../App';
import { clearUserOrganization } from '../../lib/firestore';
import { logout } from '../../lib/auth';

/** 비활성화/기관 삭제 등 차단 상태 공통 화면 */
export function BlockedScreen({ emoji, title, description, uid }: {
  emoji: string;
  title: string;
  description: ReactNode;
  uid: string;
}) {
  const handleTransferOrg = async () => {
    try {
      await clearUserOrganization(uid);
    } catch (err) {
      console.error('기관 이동 실패:', err);
    }
  };
  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex items-center justify-center p-4">
      <div className="glass-card max-w-md w-full p-8 text-center">
        <div className="text-5xl mb-4">{emoji}</div>
        <h2 className="text-xl font-bold text-surface-900 dark:text-surface-100 mb-2">{title}</h2>
        <p className="text-surface-500 dark:text-surface-400 text-sm mb-6">{description}</p>
        <div className="space-y-3">
          <button onClick={handleTransferOrg} className="btn-primary w-full min-h-[48px]">
            다른 기관으로 가입
          </button>
          <button
            onClick={() => { logout(); }}
            className="btn-ghost w-full text-surface-500 min-h-[48px]"
          >
            로그아웃
          </button>
        </div>
      </div>
    </div>
  );
}

interface AuthGuardProps {
  children: ReactNode;
  requireAuth?: boolean;
  requireGuest?: boolean;
  allowedRoles?: Array<'employee' | 'admin' | 'superAdmin'>;
  requireOrgSetup?: boolean;
}

export function AuthGuard({
  children,
  requireAuth = false,
  requireGuest = false,
  allowedRoles,
  requireOrgSetup = false,
}: AuthGuardProps) {
  const { user, userData, isSuperAdmin, orgDeleted } = useAuth();
  const saTestRole = useMemo(() => (isSuperAdmin ? localStorage.getItem(SA_TEST_ROLE_KEY) : null), [isSuperAdmin]);

  // 1. 비로그인 상태 가드 (Guest 전용 라우트 접근 시 대시보드로 이동)
  if (requireGuest && user) {
    let effectiveRole = userData?.role;
    if (isSuperAdmin && saTestRole) {
      if (saTestRole === 'admin') effectiveRole = 'admin';
      else if (saTestRole === 'employee') effectiveRole = 'employee';
    }

    if (effectiveRole === 'superAdmin') return <Navigate to="/super-admin" replace />;
    if (effectiveRole === 'admin') return <Navigate to="/admin" replace />;
    if (effectiveRole === 'employee') return <Navigate to="/employee" replace />;
    return <Navigate to="/invite" replace />;
  }

  // 2. 로그인 필요 가드
  if (requireAuth && !user) {
    return <Navigate to="/login" replace />;
  }

  if (!requireAuth && !user) {
    return <>{children}</>;
  }

  if (requireAuth && user && !userData) {
    // 유저 데이터 로딩을 아직 못한 것이 아니라 실제로 없는 경우 (신규가입)
    // superAdmin은 기관 소속 없이도 접근 가능하므로 invite로 보내지 않음
    if (isSuperAdmin) {
      return <Navigate to="/super-admin" replace />;
    }
    if (requireOrgSetup) {
      return <Navigate to="/invite" replace />;
    }
  }

  // 3. 차단된 사용자 (disabled)
  if (userData?.status === 'disabled') {
    return (
      <BlockedScreen
        emoji="🔒"
        title="계정이 비활성화되었습니다"
        description={<>기관 관리자에 의해 계정이 비활성화되었습니다.<br />관리자가 다시 활성화하면 이용하실 수 있습니다.</>}
        uid={user!.uid}
      />
    );
  }

  // 4. 기관 삭제됨
  if (orgDeleted) {
    return (
      <BlockedScreen
        emoji="🏢"
        title="기관이 삭제되었습니다"
        description={<>소속 기관이 관리자에 의해 삭제되었습니다.<br />다른 기관의 초대 코드로 새로 가입할 수 있습니다.</>}
        uid={user!.uid}
      />
    );
  }

  // 5. 기관 셋업 파악 (기관 소속 전)
  if (requireOrgSetup && userData) {
    if (!userData.organizationId && !isSuperAdmin) {
      return <Navigate to="/invite" replace />;
    }
    if (userData.role === 'admin' && userData.organizationStatus === 'pending') {
      return <Navigate to="/pending" replace />;
    }
  }

  // 6. Role 권한 파악
  if (allowedRoles && userData) {
    // 슈퍼관리자 테스트 모드 적용
    let effectiveRole = userData.role;
    if (isSuperAdmin) {
      if (saTestRole === 'admin') effectiveRole = 'admin';
      else if (saTestRole === 'employee') effectiveRole = 'employee';
      else effectiveRole = 'superAdmin';
    }

    if (!allowedRoles.includes(effectiveRole)) {
      // 권한 없음 → 자신의 대시보드로 리다이렉트
      if (effectiveRole === 'superAdmin') return <Navigate to="/super-admin" replace />;
      if (effectiveRole === 'admin') return <Navigate to="/admin" replace />;
      return <Navigate to="/employee" replace />;
    }
  }

  return <>{children}</>;
}
