import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import ConfirmModal from './components/common/ConfirmModal';
import { useConfirmStore } from './store/useConfirmStore';
import { useThemeStore } from './store/useThemeStore';
import { useFontSizeStore } from './store/useFontSizeStore';
import { lazyWithRetry } from './lib/lazyWithRetry';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useOrientationLock } from './hooks/useOrientationLock';
import { AuthGuard } from './components/auth/AuthGuard';
import { updateUser } from './lib/firestore/users';
import { isInAppBrowser } from './lib/inAppBrowser';
import InAppBrowserWarning from './components/common/InAppBrowserWarning';

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
const ReleaseNotesPage = lazyWithRetry(() => import('./components/auth/ReleaseNotesPage'));
const FAQPage = lazyWithRetry(() => import('./components/auth/FAQPage'));

// 슈퍼관리자 테스트 모드: 기관 관리자·직원 UI 체험 (sessionStorage key)
export const SA_TEST_ROLE_KEY = 'sa-test-role' as const;

export function LoadingScreen() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-100 dark:from-surface-950 dark:via-surface-900 dark:to-surface-950">
      <div className="text-center animate-fade-in">
        <div className="w-16 h-16 spinner mx-auto mb-4"></div>
        <p className="text-surface-500 font-medium">로딩 중...</p>
        {elapsed >= 2 && elapsed < 8 && (
          <p className="mt-2 text-sm text-surface-400">권한 정보를 동기화 중입니다…</p>
        )}
        {elapsed >= 8 && (
          <p className="mt-2 text-sm text-surface-400">네트워크가 느리거나 보안 인증이 지연되고 있습니다.</p>
        )}
      </div>
    </div>
  );
}

/** 컴포넌트 마운트 에러 캐치용 Fallback (필요시 ErrorBoundary 추가 가능) */
function RouteFallback() {
  const { user, userData } = useAuth();
  if (!user) return <Navigate to="/" replace />;
  if (!userData) return <Navigate to="/invite" replace />;
  if (userData.role === 'superAdmin') return <Navigate to="/super-admin" replace />;
  if (userData.role === 'admin') return <Navigate to="/admin" replace />;
  return <Navigate to="/employee" replace />;
}

/** 약관/개인정보 공통 라우트 (모든 인증 상태에서 접근 가능) */
const legalRoutes = [
  <Route key="terms" path="/terms" element={<TermsPage />} />,
  <Route key="privacy" path="/privacy" element={<PrivacyPage />} />,
  <Route key="release-notes" path="/release-notes" element={<ReleaseNotesPage />} />,
  <Route key="faq" path="/faq" element={<FAQPage />} />,
];


import toast from 'react-hot-toast';

export default function App() {

  // 전역 비동기 에러(App Check 등) 캐치 후 사용자 UI 피드백 제공
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason?.message || event.reason?.toString() || '';
      if (
        reason.includes('appCheck/throttled') ||
        reason.includes('appCheck/initial-throttle') ||
        (reason.includes('AppCheck') && reason.includes('500 error'))
      ) {
        // react-hot-toast 동일 ID 지정 시 중복 팝업 방지
        toast.error('현재 네트워크 환경이 불안정하여 보안 인증이 지연되고 있습니다. 1분 후 다시 시도해주세요.', { 
          id: 'appcheck-error',
          duration: 5000 
        });
      }
    };
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  }, []);

  const theme = useThemeStore(state => state.theme);
  const setTheme = useThemeStore(state => state.setTheme);
  const fontSize = useFontSizeStore(state => state.fontSize);

  // <html>에 dark 클래스 토글 + theme-color 메타 태그 동기화
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Android 상태바 색상을 테마 배경색과 통일
    const themeColor = theme === 'dark' ? '#020617' : '#f8fafc';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', themeColor);
    }
  }, [theme]);

  // 시스템 설정 변경 감지 (사용자가 수동 설정한 경우 무시)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const stored = localStorage.getItem('theme-preference');
      if (!stored) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [setTheme]);

  // <html>에 font-size class 적용
  useEffect(() => {
    const root = document.documentElement;
    // 이전 class 제거
    root.classList.remove('font-small', 'font-normal', 'font-large');
    // 새 class 추가
    root.classList.add(`font-${fontSize}`);
  }, [fontSize]);



  const open = useConfirmStore(state => state.open);
  const options = useConfirmStore(state => state.options);
  const handleConfirm = useConfirmStore(state => state.handleConfirm);
  const handleCancel = useConfirmStore(state => state.handleCancel);

  // 인앱 브라우저 감지 시 메인 화면 마운트 대신 안내 화면만 표시
  // (React Rules of Hooks 준수를 위해 모든 훅 호출 이후에 얼리 리턴 위치)
  if (isInAppBrowser()) {
    return <InAppBrowserWarning />;
  }

  return (
    <>
      <AppContent />
      <ConfirmModal
        open={open}
        title={options.title}
        message={options.message}
        confirmText={options.confirmText || '확인'}
        cancelText={options.cancelText || '취소'}
        confirmColor={options.confirmColor || 'primary'}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}

function AppContent() {
  const { user, userData, loading } = useAuth();
  useOrientationLock();
  const theme = useThemeStore(state => state.theme);
  const setTheme = useThemeStore(state => state.setTheme);

  // Firestore DB <-> 로컬 테마 상태 양방향 동기화
  const isThemeFirstSynced = useRef(false);

  useEffect(() => {
    if (!user || !userData) {
      isThemeFirstSynced.current = false;
      return;
    }

    // 1. 로그인 직후(초기 1회): DB 테마 정보가 있다면 로컬 스토어에 반영
    if (!isThemeFirstSynced.current && userData.theme) {
      if (userData.theme !== theme) {
        setTheme(userData.theme as 'light' | 'dark');
      }
      isThemeFirstSynced.current = true;
      return;
    }

    // 2. 초기 동기화 이후: 로컬 테마 변경 시 DB에 업데이트
    if (isThemeFirstSynced.current || !userData.theme) {
      if (userData.theme !== theme) {
        updateUser(user.uid, { theme }).catch(err => {
          console.error('테마 설정 DB 동기화 실패:', err);
        });
        // 테마가 없던 사용자가 처음 설정한 경우에도 이후엔 동기화된 것으로 간주
        if (!isThemeFirstSynced.current) isThemeFirstSynced.current = true;
      }
    }
  }, [user, userData, theme, setTheme]);

  // 이메일 링크의 ?code= 파라미터를 localStorage에 저장
  // (Google 로그인 리다이렉트 도메인 횡단 시 sessionStorage 증발 방지)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      localStorage.setItem('pendingInviteCode', code.toUpperCase());
      params.delete('code');
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params}`
        : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  // 서비스 워커의 알림 클릭 postMessage 수신 → 네비게이션
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_CLICK' && event.data?.url) {
        // Open Redirect 방지: 같은 origin의 URL만 허용
        try {
          const targetUrl = new URL(event.data.url, window.location.origin);
          if (targetUrl.origin === window.location.origin) {
            window.location.href = targetUrl.href;
          }
        } catch { /* 잘못된 URL은 무시 */ }
      }
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => navigator.serviceWorker?.removeEventListener('message', handler);
  }, []);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        {/* Guest 전용 (로그인 시 대시보드로 리다이렉트됨) */}
        <Route path="/" element={<AuthGuard requireGuest><LandingPage /></AuthGuard>} />
        <Route path="/login" element={<AuthGuard requireGuest><LoginPage /></AuthGuard>} />
        
        {/* 기관 가입/생성 (로그인은 했지만 기관이 없거나 등록 중인 상태 허용) */}
        <Route path="/invite" element={<AuthGuard requireAuth><InviteCodePage /></AuthGuard>} />
        <Route path="/apply" element={<AuthGuard requireAuth><OrgApplicationPage /></AuthGuard>} />
        <Route path="/pending" element={<AuthGuard requireAuth><PendingApprovalPage /></AuthGuard>} />

        {/* 역할별 메인 레이아웃 (기관 설정 완료 & 역할 일치 필요) */}
        <Route path="/super-admin/*" element={
          <AuthGuard requireAuth allowedRoles={['superAdmin']}>
            <SuperAdminLayout />
          </AuthGuard>
        } />
        <Route path="/admin/*" element={
          <AuthGuard requireAuth requireOrgSetup allowedRoles={['admin']}>
            <AdminLayout />
          </AuthGuard>
        } />
        <Route path="/employee/*" element={
          <AuthGuard requireAuth requireOrgSetup allowedRoles={['admin', 'employee']}>
            <EmployeeLayout />
          </AuthGuard>
        } />

        {/* 약관 등 공통 */}
        {legalRoutes}

        {/* Catch-all - 권한에 맞는 대시보드로 자동 리다이렉트 */}
        <Route path="*" element={<RouteFallback />} />
      </Routes>
      
      {/* 캘린더 예약 취소 핸들러 (관리자, 직원 전용 UI 헬퍼) */}
      {(userData?.role === 'admin' || userData?.role === 'employee') && (
        <Suspense fallback={null}><CancelReservationHandler /></Suspense>
      )}
    </Suspense>
  );
}
