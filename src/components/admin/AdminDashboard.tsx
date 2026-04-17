/**
 * AdminDashboard — 관리자 대시보드 페이지
 * AdminLayout에서 추출된 별도 컴포넌트
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { auth } from '../../lib/firebase';
import { refreshTokenSilently } from '../../lib/tokenRefresh';
import { getVehicles, getOrganizationMembers, getDriveLogs, getOrganization, getTodayReservations } from '../../lib/firestore';
import { getDriveLogAggregatedStats } from '../../lib/firestore/driveLogs';
import { toLocalDateStr } from '../../lib/dateUtils';
import { SkeletonStatCard, SkeletonList } from '../common/Skeleton';
import type { DriveLog } from '../../types/driveLog';
import type { Organization } from '../../types/organization';
import AdminOnboardingWizard from './AdminOnboardingWizard';

export default function AdminDashboard() {
    const { userData } = useAuth();
    const navigate = useNavigate();
    const [stats, setStats] = useState({
        todayLogs: 0,
        todayReservations: 0,
        vehicleCount: 0,
        employeeCount: 0,
        monthLogs: 0,
        totalLogs: 0,
        totalDistance: 0,
    });
    const [recentLogs, setRecentLogs] = useState<DriveLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [inviteCode, setInviteCode] = useState('');

    useEffect(() => {
        if (!userData?.organizationId) return;
        const orgId = userData.organizationId;

        const fetchStats = async (retryCount = 0) => {
            try {
                const todayStr = toLocalDateStr();
                const d = new Date();
                const y = d.getFullYear();
                const m = d.getMonth() + 1;
                const monthKey = `${y}-${String(m).padStart(2, '0')}`;

                const [vehicles, members, logsResult, todayRes, todayLogs, aggregatedData] = await Promise.all([
                    getVehicles(orgId),
                    getOrganizationMembers(orgId),
                    getDriveLogs(orgId, { limit: 5 }),
                    getTodayReservations(orgId, todayStr),
                    import('../../lib/firestore/driveLogs').then(m => m.getDriveLogCount(orgId, { startDate: todayStr, endDate: todayStr })),
                    getDriveLogAggregatedStats(orgId)
                ]);

                const logs = logsResult.docs;
                const monthLogs = aggregatedData?.monthlyStats?.[monthKey]?.count || 0;

                setStats({
                    todayLogs,
                    todayReservations: todayRes.filter(r => r.status === 'reserved' || r.status === 'in_progress').length,
                    vehicleCount: vehicles.length,
                    employeeCount: members.filter(m => m.role !== 'superAdmin').length,
                    monthLogs,
                    totalLogs: aggregatedData?.count || 0,
                    totalDistance: aggregatedData?.totalDistance || 0,
                });
                setRecentLogs(logs as DriveLog[]);

                // 온보딩 위자드 표시 조건 확인
                if (AdminOnboardingWizard.shouldShow(vehicles.length, members.length)) {
                    setShowOnboarding(true);
                    try {
                        const org = await getOrganization(orgId);
                        setInviteCode((org as Organization)?.inviteCode || '');
                    } catch { /* noop */ }
                }
            } catch (err) {
                // Custom Claims 토큰이 아직 갱신되지 않은 경우 재시도 (최대 2회)
                const firebaseErr = err as { code?: string; message?: string };
                const isPermError = firebaseErr.code === 'permission-denied'
                    || firebaseErr.message?.includes('Missing or insufficient permissions');

                if (isPermError && retryCount < 2) {
                    const delayMs = 1500 * Math.pow(2, retryCount); // 지수 백오프: 1차 1.5초, 2차 3초
                    console.debug(`대시보드 권한 오류 — 토큰 갱신 후 재시도 (${retryCount + 1}/2, ${delayMs}ms 대기)`);
                    try { if (auth.currentUser) await refreshTokenSilently(auth.currentUser); } catch { /* noop */ }
                    // 토큰 갱신 후 잠시 대기 (Claims 전파 시간 확보 및 지수 백오프)
                    await new Promise(r => setTimeout(r, delayMs));
                    return fetchStats(retryCount + 1);
                }
                console.error('대시보드 로드 실패:', err);

                // 권한 오류로 데이터 로드에 실패해도 온보딩 위자드는 표시
                // (차량/직원 0인 상태이므로 shouldShow = true)
                if (isPermError) {
                    setShowOnboarding(true);
                    try {
                        const org = await getOrganization(orgId);
                        setInviteCode((org as Organization)?.inviteCode || '');
                    } catch { /* noop */ }
                }
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, [userData?.organizationId]);

    const statCards = [
        { label: '오늘 운행', value: `${stats.todayLogs}건`, icon: '🚗', color: 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400' },
        { label: '오늘 예약', value: `${stats.todayReservations}건`, icon: '📅', color: 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400' },
        { label: '이번 달 운행', value: `${stats.monthLogs}건`, icon: '📊', color: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' },
        { label: '등록 차량/직원', value: `${stats.vehicleCount}대 / ${stats.employeeCount}명`, icon: '🏢', color: 'bg-accent-50 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400' },
        { label: '누적 주행거리', value: `${Math.round(stats.totalDistance).toLocaleString()}km`, icon: '🛣️', color: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' },
    ];

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            {showOnboarding && (
                <AdminOnboardingWizard
                    inviteCode={inviteCode}
                    onDismiss={() => setShowOnboarding(false)}
                />
            )}
            <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-6">대시보드</h1>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
                {statCards.map((stat) => (
                    <div key={stat.label} className="glass-card p-4">
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-xs text-surface-500 dark:text-surface-400 mb-1 whitespace-nowrap">{stat.label}</p>
                                <p className="text-xl font-bold text-surface-900 dark:text-surface-100">
                                    {loading ? <span className="w-5 h-5 spinner inline-block" /> : stat.value}
                                </p>
                            </div>
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${stat.color}`}>
                                {stat.icon}
                            </div>
                        </div>
                    </div>
                ))}
            </div>



            {recentLogs.length > 0 ? (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">최근 운행 기록</h2>
                    <div className="space-y-3">
                        {recentLogs.map(log => (
                            <div key={log.id} className="flex items-center justify-between p-3 rounded-xl bg-surface-50 dark:bg-surface-800">
                                <div>
                                    <p className="font-medium text-sm text-surface-900 dark:text-surface-100">{log.driverName || '(이름 없음)'}</p>
                                    <p className="text-xs text-surface-400">{log.destination || '-'}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-mono text-surface-600 dark:text-surface-400">{(log.endKm - log.startKm) || 0} km</p>
                                    <p className="text-xs text-surface-400">
                                        {(() => { const ts = log.timestamp; return (ts && typeof ts === 'object' && 'toDate' in ts && typeof (ts as { toDate?: unknown }).toDate === 'function') ? (ts as { toDate: () => Date }).toDate().toLocaleDateString('ko-KR') : '-'; })()}
                                        {log.startTime && log.endTime && ` ${log.startTime}~${log.endTime}`}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="glass-card p-8 text-center">
                    {loading ? (
                        <p className="text-surface-400">데이터를 불러오는 중...</p>
                    ) : (
                        <>
                            <div className="text-4xl mb-3">📋</div>
                            <p className="text-surface-500 dark:text-surface-400 font-medium mb-1">아직 운행 기록이 없습니다</p>
                            <p className="text-sm text-surface-400 mb-4">
                                직원들이 운행을 시작하면 이곳에 기록이 표시됩니다.
                            </p>
                            {stats.vehicleCount === 0 && (
                                <button onClick={() => navigate('/admin/vehicles')} className="btn-primary btn-sm">
                                    🚗 먼저 차량을 등록하세요
                                </button>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
