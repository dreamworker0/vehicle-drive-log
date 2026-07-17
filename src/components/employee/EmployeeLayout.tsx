import { useState, useEffect, Suspense, startTransition } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import { getOrganization } from '../../lib/firestore';
import { SA_TEST_ROLE_KEY } from '../../App';
import NotificationBell from '../common/NotificationBell';
import AdminNotice from '../admin/AdminNotice';
import IOSInstallPrompt from '../common/IOSInstallPrompt';
import useBackButton from '../../hooks/useBackButton';
import useReleaseNotesStatus from '../../hooks/useReleaseNotesStatus';
import ErrorBoundary from '../common/ErrorBoundary';

const TodayDashboard = lazyWithRetry(() => import('./TodayDashboard'));
const DriveLogForm = lazyWithRetry(() => import('./DriveLogForm'));
const QuickDriveStart = lazyWithRetry(() => import('./QuickDriveStart'));
const MyRecords = lazyWithRetry(() => import('./MyRecords'));
const ReservationCalendar = lazyWithRetry(() => import('../common/ReservationCalendar'));
const FavoritesManager = lazyWithRetry(() => import('./FavoritesManager'));
const VehicleHistory = lazyWithRetry(() => import('./VehicleHistory'));
const FuelLogTab = lazyWithRetry(() => import('./FuelLogTab'));
const MorePage = lazyWithRetry(() => import('./MorePage'));

interface NavItem {
    to: string;
    label: string;
    icon: React.ReactElement;
}

const navItems: NavItem[] = [
    {
        to: '/employee/fuel',
        label: '차량관리',
        icon: (
            <svg aria-hidden="true" className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11.25V4.875A2.625 2.625 0 0 0 12.375 2.25h-4.75A2.625 2.625 0 0 0 5 4.875V18.75a2.25 2.25 0 0 0 2.25 2.25h5.5A2.25 2.25 0 0 0 15 18.75v-3" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 8.25h1.5a2.25 2.25 0 0 1 2.25 2.25v3a1.5 1.5 0 0 0 3 0V7.5l-2.25-3" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 9h9.5" />
            </svg>
        ),
    },
    {
        to: '/employee/reservations',
        label: '예약',
        icon: (
            <svg aria-hidden="true" className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
        ),
    },
    {
        to: '/employee/today',
        label: '운행',
        icon: (
            <svg aria-hidden="true" className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2" />
                <circle cx="6.5" cy="16.5" r="2.5" />
                <circle cx="16.5" cy="16.5" r="2.5" />
            </svg>
        ),
    },
    {
        to: '/employee/my-records',
        label: '내 기록',
        icon: (
            <svg aria-hidden="true" className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
        ),
    },
    {
        to: '/employee/more',
        label: '더보기',
        icon: (
            <svg aria-hidden="true" className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
            </svg>
        ),
    },
];

export default function EmployeeLayout() {
    const { userData, isSuperAdmin } = useAuth();
    const navigate = useNavigate();
    const [orgName, setOrgName] = useState('');
    const { hasNew: hasNewReleaseNotes } = useReleaseNotesStatus();
    useBackButton();

    useEffect(() => {
        if (!userData?.organizationId) return;
        getOrganization(userData.organizationId)
            .then(org => org && setOrgName(org.name || ''))
            .catch(() => { });
    }, [userData?.organizationId]);

    return (
        <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex flex-col">
            {/* 상단 바 */}
            <header className="sticky top-0 z-30 bg-white/80 dark:bg-surface-900/80 backdrop-blur-md border-b border-surface-100 dark:border-surface-700 px-4 h-14 flex items-center justify-between safe-top">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary-100 dark:bg-primary-900/40 rounded-lg flex items-center justify-center">
                        <svg aria-hidden="true" className="w-4 h-4 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                        </svg>
                    </div>
                    <span className="font-semibold text-surface-900 dark:text-surface-100 text-sm">{orgName || '운행일지'}</span>
                </div>
                <div className="flex items-center gap-2">
                    {isSuperAdmin && (
                        <button
                            onClick={() => { localStorage.removeItem(SA_TEST_ROLE_KEY); window.location.href = '/super-admin'; }}
                            className="flex items-center justify-center gap-1 text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 px-3 py-2 rounded-lg transition-colors font-medium"
                            title="슈퍼관리자 화면으로 복귀"
                        >
                            ⚡ 슈퍼관리자
                        </button>
                    )}
                    {(userData?.role === 'admin' || isSuperAdmin) && (
                        <button
                            onClick={() => {
                                if (isSuperAdmin) {
                                    localStorage.setItem(SA_TEST_ROLE_KEY, 'admin');
                                    window.location.href = '/admin';
                                } else {
                                    startTransition(() => {
                                        navigate('/admin');
                                    });
                                }
                            }}
                            className="btn-icon text-surface-500 dark:text-surface-400 hover:text-primary-600 dark:hover:text-primary-400 flex items-center justify-center"
                            title="관리자 화면으로 전환"
                        >
                            <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                            </svg>
                        </button>
                    )}
                    <AdminNotice />
                    <NotificationBell />
                </div>
            </header>

            {/* iOS Safari 홈 화면 추가 안내 */}
            <IOSInstallPrompt />

            {/* 메인 콘텐츠 */}
            <main className="flex-1 p-4 overflow-y-auto" style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}>
                <ErrorBoundary>
                <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="w-8 h-8 spinner" /></div>}>
                    <Routes>
                        <Route path="today" element={<TodayDashboard />} />
                        <Route path="drive-log" element={<DriveLogForm />} />
                        <Route path="quick-drive" element={<QuickDriveStart />} />
                        <Route path="fuel" element={<FuelLogTab />} />
                        <Route path="my-records" element={<MyRecords />} />
                        <Route path="reservations" element={<ReservationCalendar />} />
                        <Route path="favorites" element={<FavoritesManager />} />
                        <Route path="vehicle-history" element={<VehicleHistory />} />
                        <Route path="more" element={<MorePage />} />
                        <Route path="" element={<Navigate to="today" replace />} />
                    </Routes>
                </Suspense>
                </ErrorBoundary>
            </main>

            {/* 하단 탭 바 (모바일 최적화) */}
            <nav className="fixed bottom-0 left-0 right-0 bg-white/85 dark:bg-surface-900/85 backdrop-blur-xl border-t border-surface-200/50 dark:border-surface-700/50 z-30 safe-bottom" aria-label="직원 메뉴">
                <div className="flex items-center justify-between h-[68px] max-w-lg mx-auto px-4 relative">
                    {navItems.map((item, idx) => {
                        // NavLink 클릭 시 startTransition을 통해 부드러운 페이지 전환 유도
                        const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
                            if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                                e.preventDefault();
                                startTransition(() => {
                                    navigate(item.to);
                                });
                            }
                        };

                        // 중앙의 Elevated FAB (주유/충전)
                        if (idx === 2) {
                            return (
                                <NavLink
                                    key={item.to}
                                    to={item.to}
                                    onClick={handleNavClick}
                                    className={({ isActive }) =>
                                        `absolute left-1/2 -translate-x-1/2 -top-5 flex flex-col items-center justify-center w-14 h-14 rounded-full shadow-lg transition-all duration-300 transform hover:scale-105 active:scale-95 ${isActive
                                            ? 'bg-primary-600 dark:bg-primary-500 text-white ring-4 ring-white/50 dark:ring-surface-900/50'
                                            : 'bg-surface-800 text-surface-50 dark:bg-surface-200 dark:text-surface-900 ring-4 ring-surface-50 dark:ring-surface-900 shadow-surface-300/50 dark:shadow-black/50 hover:bg-surface-700 dark:hover:bg-surface-300'
                                        }`
                                    }
                                >
                                    <div className="scale-110">{item.icon}</div>
                                </NavLink>
                            );
                        }

                        // 일반 탭 아이템
                        return (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                onClick={handleNavClick}
                                className={({ isActive }) =>
                                    `flex flex-col items-center justify-center gap-1 w-14 py-1.5 min-h-[48px] rounded-xl transition-all duration-200 ${
                                        idx === 1 ? 'mr-14' : idx === 3 ? 'ml-14' : ''
                                    } ${isActive
                                        ? 'text-primary-600 dark:text-primary-400 font-bold'
                                        : 'text-surface-400 dark:text-surface-500 hover:text-surface-600 hover:bg-surface-100/50 dark:hover:bg-surface-800/50 font-medium'
                                    }`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <div className={`relative ${isActive ? 'scale-110 transition-transform' : 'transition-transform'}`}>
                                            {item.icon}
                                            {item.to === '/employee/more' && hasNewReleaseNotes && (
                                                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-surface-900" />
                                            )}
                                        </div>
                                        <span className={`text-[10px] ${isActive ? 'tracking-tight' : ''}`}>{item.label}</span>
                                    </>
                                )}
                            </NavLink>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
}
