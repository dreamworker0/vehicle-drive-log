import { useState, useEffect, Suspense, type ReactNode } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { logout } from '../../lib/auth';
import { getApprovedOrganizations } from '../../lib/firestore/organizations';
import { getOrgMemberCounts } from '../../lib/firestore/users';
import { getPendingOrganizationsCount, getApprovedOrganizationsCount } from '../../lib/firestore/organizations';
import { getUnreadFeedbacksCount } from '../../lib/firestore/feedbacks';
import { getSuperAdminsCount } from '../../lib/firestore/superAdmin';
import { SA_TEST_ROLE_KEY } from '../../App';
import { useTheme } from '../../hooks/useTheme';
import Toggle from '../common/Toggle';


import { lazyWithRetry } from '../../lib/lazyWithRetry';

const OrgApplicationList = lazyWithRetry(() => import('./OrgApplicationList'));
const OrgManagement = lazyWithRetry(() => import('./OrgManagement'));
const FeedbackManagement = lazyWithRetry(() => import('./FeedbackManagement'));
const SuperAdminManager = lazyWithRetry(() => import('./SuperAdminManager'));
const ServiceDashboard = lazyWithRetry(() => import('./ServiceDashboard'));
const ApiHealthPage = lazyWithRetry(() => import('./ApiHealthPage'));

interface NavItemProps {
    to: string;
    icon: ReactNode;
    label: string;
    badge?: number | null;
}

function NavItem({ to, icon, label, badge }: NavItemProps) {
    return (
        <NavLink
            to={to}
            className={({ isActive }) =>
                `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`
            }
        >
            {icon}
            <span>{label}</span>
            {badge != null && (
                <span className={`ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-semibold rounded-full ${badge > 0 ? 'badge-primary' : 'bg-surface-100 text-surface-400 dark:bg-surface-800 dark:text-surface-500'}`}>
                    {badge}
                </span>
            )}
        </NavLink>
    );
}

export default function SuperAdminLayout() {
    const { user, userData } = useAuth();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);
    const [activeOrgCount, setActiveOrgCount] = useState(0);
    const [totalOrgCount, setTotalOrgCount] = useState(0);
    const [feedbackCount, setFeedbackCount] = useState(0);
    const [adminCount, setAdminCount] = useState(0);
    const { isDark, toggleTheme } = useTheme();

    // 사이드바 배지 카운트 단발성 조회 (비용 절감)
    useEffect(() => {
        let isMounted = true;
        const fetchCounts = async () => {
            if (!user || userData?.role !== 'superAdmin') return; // Auth/AppCheck 검증 안된 상태 쿼리 차단

            try {
                const [pendingsCount, approvedCount, unreadFeedbackCount] = await Promise.all([
                    getPendingOrganizationsCount(),
                    getApprovedOrganizationsCount(),
                    getUnreadFeedbacksCount()
                ]);

                if (!isMounted) return;

                setPendingCount(pendingsCount);
                setTotalOrgCount(approvedCount);
                setFeedbackCount(unreadFeedbackCount);

                try {
                    const approved = await getApprovedOrganizations();
                    const counts = await getOrgMemberCounts(approved.map(o => o.id));
                    if (isMounted) {
                        const active = approved.filter(o => counts[o.id] > 0).length;
                        setActiveOrgCount(active);
                    }
                } catch {
                    if (isMounted) setActiveOrgCount(approvedCount);
                }
            } catch(e) {
                const err = e as { code?: string; message?: string };
                if (err?.code === 'permission-denied' || err?.message?.includes('Missing or insufficient permissions')) {
                    // AppCheck 실패 또는 권한 없음 에러는 의도된 방어이므로 에러 노이즈 억제
                    console.warn("SuperAdmin 뱃지 카운트 조회 억제됨 (권한 부족)");
                } else {
                    console.error("SuperAdmin 뱃지 카운트 조회 에러:", e);
                }
            }
        };

        fetchCounts();

        return () => { isMounted = false; };
    }, [user, userData?.role]);

    // 슈퍼관리자 수 조회
    useEffect(() => {
        getSuperAdminsCount().then(count => setAdminCount(count)).catch(() => {});
    }, []);

    return (
        <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex">
            {/* 모바일 오버레이 */}
            {sidebarOpen && (
                <div
                    role="presentation"
                    className="fixed inset-0 bg-black/30 z-40 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setSidebarOpen(false); }}
                />
            )}

            {/* 사이드바 */}
            <aside className={`
        fixed lg:sticky inset-y-0 left-0 lg:top-0 lg:h-screen z-50
        w-64 bg-white dark:bg-surface-900 border-r border-surface-100 dark:border-surface-700
        transform transition-transform duration-300 ease-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        flex flex-col
      `}>
                <div className="p-4 border-b border-surface-100 dark:border-surface-700">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/40 rounded-xl flex items-center justify-center">
                            <svg className="w-5 h-5 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
                            </svg>
                        </div>
                        <div>
                            <p className="font-semibold text-surface-900 dark:text-surface-100 text-sm">시스템 관리자</p>
                            <p className="text-xs text-surface-400 dark:text-surface-500">{user?.email}</p>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                    <NavItem
                        to="/super-admin/applications"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9z" />
                            </svg>
                        }
                        label="신청 관리"
                        badge={pendingCount}
                    />
                    <NavItem
                        to="/super-admin/organizations"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 3v18m16.5-18v18M5.25 3h13.5M5.25 21h13.5M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                            </svg>
                        }
                        label="기관 관리"
                        badge={activeOrgCount}
                    />
                    <NavItem
                        to="/super-admin/dashboard"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
                            </svg>
                        }
                        label="운영 대시보드"
                        badge={totalOrgCount}
                    />
                    <NavItem
                        to="/super-admin/feedbacks"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
                            </svg>
                        }
                        label="의견 관리"
                        badge={feedbackCount}
                    />
                    <NavItem
                        to="/super-admin/admins"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                            </svg>
                        }
                        label="관리자 관리"
                        badge={adminCount}
                    />
                    <NavItem
                        to="/super-admin/api-health"
                        icon={
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 13.5l3-3 3 3m-3-3v10.5m-3.75-15h7.5a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25h-7.5a2.25 2.25 0 0 1-2.25-2.25v-7.5a2.25 2.25 0 0 1 2.25-2.25z" />
                            </svg>
                        }
                        label="헬스 체크"
                    />

                </nav>

                <div className="p-3 border-t border-surface-100 dark:border-surface-700 space-y-1">


                    <div className="flex items-center justify-between px-3 py-2 rounded-lg">
                        <div className="flex items-center gap-3">
                            {isDark ? (
                                <svg className="w-5 h-5 text-amber-400 dark:text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5 text-amber-500 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
                                </svg>
                            )}
                            <span className="text-sm text-surface-600 dark:text-surface-300">{isDark ? '다크 모드' : '라이트 모드'}</span>
                        </div>
                        <Toggle label="다크 모드" checked={isDark} onChange={toggleTheme} />
                    </div>
                    <button onClick={logout} className="sidebar-link w-full text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-300 min-h-[48px]">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                        </svg>
                        <span>로그아웃</span>
                    </button>
                </div>
            </aside>

            {/* 메인 콘텐츠 */}
            <main className="flex-1 flex flex-col min-w-0">
                {/* 상단 바 */}
                <header className="sticky top-0 z-30 bg-white/80 dark:bg-surface-900/80 backdrop-blur-md border-b border-surface-100 dark:border-surface-700 px-4 lg:px-6 h-14 flex items-center justify-between safe-top">
                    <button
                        onClick={() => setSidebarOpen(true)}
                        className="btn-icon lg:hidden min-h-[48px] min-w-[48px]"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                        </svg>
                    </button>
                    <div className="flex-1" />
                    {/* 테스트 모드 버튼 (전체 화면) */}
                    <div className="flex items-center gap-1.5 mr-2">
                        <button
                            onClick={() => { localStorage.setItem(SA_TEST_ROLE_KEY, 'admin'); window.location.href = '/admin'; }}
                            className="py-2 px-3 rounded-lg text-sm font-medium bg-primary-50 text-primary-700 active:bg-primary-100 dark:bg-primary-900/40 dark:text-primary-300 dark:active:bg-primary-900/60"
                        >
                            🏢 관리자
                        </button>
                        <button
                            onClick={() => { localStorage.setItem(SA_TEST_ROLE_KEY, 'employee'); window.location.href = '/employee'; }}
                            className="py-2 px-3 rounded-lg text-sm font-medium badge-neutral active:bg-surface-200 dark:bg-surface-700 dark:text-surface-300 dark:active:bg-surface-600"
                        >
                            🙋 직원
                        </button>
                    </div>

                </header>

                {/* 페이지 콘텐츠 */}
                <div className="flex-1 p-4 lg:p-6 overflow-y-auto">
                    <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="w-10 h-10 spinner" /></div>}>
                        <Routes>
                            <Route path="dashboard" element={<ServiceDashboard />} />
                            <Route path="applications" element={<OrgApplicationList />} />
                            <Route path="organizations" element={<OrgManagement />} />
                            <Route path="feedbacks" element={<FeedbackManagement />} />
                            <Route path="admins" element={<SuperAdminManager />} />
                            <Route path="api-health" element={<ApiHealthPage />} />
                            <Route path="" element={<Navigate to="dashboard" replace />} />
                        </Routes>
                    </Suspense>
                </div>
            </main>
        </div>
    );
}
