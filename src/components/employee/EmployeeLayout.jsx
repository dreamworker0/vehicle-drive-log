import { useState, useEffect, Suspense } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { SA_TEST_ROLE_KEY } from '../../App';
import NotificationBell from '../common/NotificationBell';
import AdminNotice from '../admin/AdminNotice';
import IOSInstallPrompt from '../common/IOSInstallPrompt';
import useBackButton from '../../hooks/useBackButton';

const TodayDashboard = lazyWithRetry(() => import('./TodayDashboard'));
const DriveLogForm = lazyWithRetry(() => import('./DriveLogForm'));
const QuickDriveStart = lazyWithRetry(() => import('./QuickDriveStart'));
const MyRecords = lazyWithRetry(() => import('./MyRecords'));
const ReservationCalendar = lazyWithRetry(() => import('../common/ReservationCalendar'));
const FavoritesManager = lazyWithRetry(() => import('./FavoritesManager'));
const VehicleHistory = lazyWithRetry(() => import('./VehicleHistory'));
const MorePage = lazyWithRetry(() => import('./MorePage'));


const navItems = [
    {
        to: '/employee/today',
        label: '오늘',
        icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
        ),
    },
    {
        to: '/employee/reservations',
        label: '예약',
        icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
        ),
    },
    {
        to: '/employee/my-records',
        label: '내 기록',
        icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
        ),
    },
    {
        to: '/employee/more',
        label: '더보기',
        icon: (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
            </svg>
        ),
    },
];

export default function EmployeeLayout() {
    const { userData, isSuperAdmin } = useAuth();
    const navigate = useNavigate();
    const [orgName, setOrgName] = useState('');
    useBackButton();

    useEffect(() => {
        if (!userData?.organizationId) return;
        getDoc(doc(db, 'organizations', userData.organizationId))
            .then(snap => snap.exists() && setOrgName(snap.data().name || ''))
            .catch(() => { });
    }, [userData?.organizationId]);

    return (
        <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex flex-col">
            {/* 상단 바 */}
            <header className="sticky top-0 z-30 bg-white/80 dark:bg-surface-900/80 backdrop-blur-md border-b border-surface-100 dark:border-surface-700 px-4 h-14 flex items-center justify-between safe-top">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary-100 dark:bg-primary-900/40 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                        </svg>
                    </div>
                    <span className="font-semibold text-surface-900 dark:text-surface-100 text-sm">{orgName || '운행일지'}</span>
                </div>
                <div className="flex items-center gap-2">
                    {isSuperAdmin && (
                        <button
                            onClick={() => { localStorage.removeItem(SA_TEST_ROLE_KEY); window.location.href = '/super-admin'; }}
                            className="flex items-center gap-1 text-xs bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 px-2.5 py-1 rounded-lg transition-colors font-medium"
                            title="슈퍼관리자 화면으로 복귀"
                        >
                            ⚡ 슈퍼관리자
                        </button>
                    )}
                    {(userData?.role === 'admin' || isSuperAdmin) && (
                        <button
                            onClick={() => navigate('/admin')}
                            className="btn-icon text-surface-500 hover:text-primary-600"
                            title="관리자 화면으로 전환"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
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
            <main className="flex-1 p-4 pb-20 overflow-y-auto">
                <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="w-8 h-8 spinner" /></div>}>
                    <Routes>
                        <Route path="today" element={<TodayDashboard />} />
                        <Route path="drive-log" element={<DriveLogForm />} />
                        <Route path="quick-drive" element={<QuickDriveStart />} />
                        <Route path="my-records" element={<MyRecords />} />
                        <Route path="reservations" element={<ReservationCalendar />} />
                        <Route path="favorites" element={<FavoritesManager />} />
                        <Route path="vehicle-history" element={<VehicleHistory />} />
                        <Route path="more" element={<MorePage />} />
                        <Route path="" element={<Navigate to="today" replace />} />
                    </Routes>
                </Suspense>
            </main>

            {/* 하단 탭 바 (모바일 최적화) */}
            <nav className="fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border-t border-surface-100 dark:border-surface-700 z-30 safe-bottom" aria-label="직원 메뉴">
                <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            className={({ isActive }) =>
                                `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-all duration-200 ${isActive
                                    ? 'text-primary-600'
                                    : 'text-surface-400 hover:text-surface-600'
                                }`
                            }
                        >
                            {item.icon}
                            <span className="text-[10px] font-medium">{item.label}</span>
                        </NavLink>
                    ))}
                </div>
            </nav>
        </div>
    );
}
