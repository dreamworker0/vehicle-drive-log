import { Suspense, useMemo, type ReactNode } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import { FontSizeProvider } from './contexts/FontSizeContext';
import { lazyWithRetry } from './lib/lazyWithRetry';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useOrientationLock } from './hooks/useOrientationLock';

// 레이아웃 (기존)
const SuperAdminLayout = lazyWithRetry(() => import('./components/superAdmin/SuperAdminLayout'));
const AdminLayout = lazyWithRetry(() => import('./components/admin/AdminLayout'));
const EmployeeLayout = lazyWithRetry(() => import('./components/employee/EmployeeLayout'));
const CancelReservationHandler = lazyWithRetry(() => import('./components/common/CancelReservationHandler'));

// auth 페이지 (lazy 전환 — 번들 최적화)
const LoginPage = lazyWithRetry(() => import('./components/auth/LoginPage'));
const LandingPage = lazyWithRetry(() => import('./components/auth/LandingPage'));
const InviteCodePage = lazyWithRetry(() => import('./components/auth/InviteCodePage'));
const OrgApplicationPage = lazyWithRetry(() => import('./components/auth/OrgApplicationPage'));
const PendingApprovalPage = lazyWithRetry(() => import('./components/auth/PendingApprovalPage'));
const TermsPage = lazyWithRetry(() => import('./components/auth/TermsPage'));
const PrivacyPage = lazyWithRetry(() => import('./components/auth/PrivacyPage'));

// 슈퍼관리자 테스트 모드: 기관 관리자·직원 UI 체험
export const SA_TEST_ROLE_KEY = 'sa-test-role';

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-100 dark:from-surface-950 dark:via-surface-900 dark:to-surface-950">
      <div className="text-center animate-fade-in">
        <div className="w-16 h-16 spinner mx-auto mb-4"></div>
        <p className="text-surface-500 font-medium">로딩 중...</p>
      </div>
    </div>
  );
}

/** 약관/개인정보 공통 라우트 (모든 인증 상태에서 접근 가능) */
const legalRoutes = [
  <Route key="terms" path="/terms" element={<TermsPage />} />,
  <Route key="privacy" path="/privacy" element={<PrivacyPage />} />,
];

interface AppRoutesProps {
  children: ReactNode;
  fallbackPath: string;
}

/** 반복되는 Suspense + Routes + legalRoutes + catch-all 패턴 통합 */
function AppRoutes({ children, fallbackPath }: AppRoutesProps) {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        {children}
        {legalRoutes}
        <Route path="*" element={<Navigate to={fallbackPath} replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <FontSizeProvider>
        <AppContent />
      </FontSizeProvider>
    </ThemeProvider>
  );
}

function AppContent() {
  const { user, userData, loading, isSuperAdmin, orgDeleted } = useAuth();
  const saTestRole = useMemo(() => (isSuperAdmin ? localStorage.getItem(SA_TEST_ROLE_KEY) : null), [isSuperAdmin]);
  useOrientationLock();

  if (loading) {
    return <LoadingScreen />;
  }

  // 1. 로그인되지 않은 경우
  if (!user) {
    return (
      <AppRoutes fallbackPath="/">
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/apply" element={<OrgApplicationPage />} />
      </AppRoutes>
    );
  }

  // 2. 슈퍼관리자
  if (isSuperAdmin) {
    // 테스트 모드: 기관 관리자 UI 체험
    if (saTestRole === 'admin') {
      return (
        <AppRoutes fallbackPath="/admin">
          <Route path="/admin/*" element={<AdminLayout />} />
          <Route path="/employee/*" element={<EmployeeLayout />} />
        </AppRoutes>
      );
    }
    // 테스트 모드: 직원 UI 체험
    if (saTestRole === 'employee') {
      return (
        <AppRoutes fallbackPath="/employee">
          <Route path="/admin/*" element={<AdminLayout />} />
          <Route path="/employee/*" element={<EmployeeLayout />} />
        </AppRoutes>
      );
    }
    // 기본: 슈퍼관리자 UI
    return (
      <AppRoutes fallbackPath="/super-admin">
        <Route path="/super-admin/*" element={<SuperAdminLayout />} />
      </AppRoutes>
    );
  }

  // 3. 사용자 데이터가 없는 경우 (신규 사용자 - 초대 코드 입력 또는 기관 신청)
  if (!userData) {
    return (
      <AppRoutes fallbackPath="/invite">
        <Route path="/invite" element={<InviteCodePage />} />
        <Route path="/apply" element={<OrgApplicationPage />} />
      </AppRoutes>
    );
  }

  // 3-1. 비활성화된 사용자 (관리자가 삭제한 직원)
  if (userData.status === 'disabled') {
    const handleTransferOrg = async () => {
      try {
        const { doc, updateDoc } = await import('firebase/firestore');
        const { db } = await import('./lib/firebase');
        await updateDoc(doc(db, 'users', user.uid), {
          status: 'active',
          organizationId: null,
          role: 'employee',
          disabledAt: null,
        });
      } catch (err) {
        console.error('기관 이동 실패:', err);
      }
    };
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex items-center justify-center p-4">
        <div className="glass-card max-w-md w-full p-8 text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-xl font-bold text-surface-900 dark:text-surface-100 mb-2">계정이 비활성화되었습니다</h2>
          <p className="text-surface-500 dark:text-surface-400 text-sm mb-6">
            기관 관리자에 의해 계정이 비활성화되었습니다.<br />
            관리자가 다시 활성화하면 이용하실 수 있습니다.
          </p>
          <div className="space-y-3">
            <button
              onClick={handleTransferOrg}
              className="btn-primary w-full"
            >
              다른 기관으로 가입
            </button>
            <button
              onClick={() => { import('./lib/auth').then(m => m.logout()); }}
              className="btn-ghost w-full text-surface-500"
            >
              로그아웃
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3-2. organizationId가 없는 사용자 (비정상 상태)
  if (!userData.organizationId && userData.role !== 'superAdmin') {
    return (
      <AppRoutes fallbackPath="/invite">
        <Route path="/invite" element={<InviteCodePage />} />
        <Route path="/apply" element={<OrgApplicationPage />} />
      </AppRoutes>
    );
  }

  // 4-1. 기관이 삭제된 경우 (soft delete → 안내 화면)
  if (orgDeleted) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex items-center justify-center p-4">
        <div className="glass-card max-w-md w-full p-8 text-center">
          <div className="text-5xl mb-4">🏢</div>
          <h2 className="text-xl font-bold text-surface-900 dark:text-surface-100 mb-2">기관이 삭제되었습니다</h2>
          <p className="text-surface-500 dark:text-surface-400 text-sm mb-6">
            소속 기관이 관리자에 의해 삭제되었습니다.<br />
            기관이 복구되면 다시 이용하실 수 있습니다.
          </p>
          <button
            onClick={() => { import('./lib/auth').then(m => m.logout()); }}
            className="btn-primary w-full"
          >
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  // 4. 기관 승인 대기 중
  if (userData.role === 'admin' && userData.organizationStatus === 'pending') {
    return (
      <AppRoutes fallbackPath="/pending">
        <Route path="/pending" element={<PendingApprovalPage />} />
      </AppRoutes>
    );
  }

  // 5. 기관관리자
  if (userData.role === 'admin') {
    return (
      <>
        <AppRoutes fallbackPath="/admin">
          <Route path="/admin/*" element={<AdminLayout />} />
          <Route path="/employee/*" element={<EmployeeLayout />} />
        </AppRoutes>
        <Suspense fallback={null}><CancelReservationHandler /></Suspense>
      </>
    );
  }

  // 6. 기관직원
  if (userData.role === 'employee') {
    return (
      <>
        <AppRoutes fallbackPath="/employee">
          <Route path="/employee/*" element={<EmployeeLayout />} />
        </AppRoutes>
        <Suspense fallback={null}><CancelReservationHandler /></Suspense>
      </>
    );
  }

  // 예외: 역할이 없는 경우
  return (
    <AppRoutes fallbackPath="/invite">
      <Route path="/invite" element={<InviteCodePage />} />
      <Route path="/apply" element={<OrgApplicationPage />} />
    </AppRoutes>
  );
}
