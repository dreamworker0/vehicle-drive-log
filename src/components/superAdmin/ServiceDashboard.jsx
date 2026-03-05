import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, getCountFromServer } from 'firebase/firestore';
import { db } from '../../lib/firebase';

/**
 * 슈퍼관리자 운영 대시보드
 * 서비스 전체 통계: 기관 수, 사용자 수, 운행 횟수, 총 주행거리
 */
export default function ServiceDashboard() {
    const [stats, setStats] = useState(null);
    const [monthlyStats, setMonthlyStats] = useState(null);
    const [topOrgs, setTopOrgs] = useState([]);
    const [orgPage, setOrgPage] = useState(0);
    const ORG_PAGE_SIZE = 10;
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadAllStats();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadAllStats = async () => {
        setLoading(true);
        try {
            await Promise.all([
                loadServiceStats(),
                loadMonthlyStats(),
                loadTopOrganizations(),
            ]);
        } finally {
            setLoading(false);
        }
    };

    // 서비스 개요 통계
    const loadServiceStats = async () => {
        try {
            const [orgSnap, userSnap, logSnap] = await Promise.all([
                getDocs(collection(db, 'organizations')),
                getDocs(collection(db, 'users')),
                getDocs(collection(db, 'driveLogs')),
            ]);

            const orgs = orgSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            const users = userSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            // 승인된 기관만 카운트 (기관 관리 페이지와 동일 기준)
            const approvedOrgs = orgs.filter(o => o.status === 'approved').length;

            // 사용자 역할별 카운트
            const totalUsers = users.filter(u => u.role !== 'superAdmin').length;
            const adminCount = users.filter(u => u.role === 'admin').length;
            const employeeCount = users.filter(u => u.role === 'employee').length;

            // 운행 통계
            const totalLogs = logSnap.size;
            let totalDistance = 0;
            logSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.distance != null && data.distance > 0) {
                    totalDistance += data.distance;
                } else {
                    const start = parseFloat(data.startKm) || 0;
                    const end = parseFloat(data.endKm) || 0;
                    if (end > start) totalDistance += (end - start);
                }
            });

            // 신청 대기 수
            let pendingApps = 0;
            try {
                const appSnap = await getCountFromServer(
                    query(collection(db, 'orgApplications'), where('status', '==', 'pending'))
                );
                pendingApps = appSnap.data().count;
            } catch { /* ignore */ }

            setStats({
                approvedOrgs,
                totalUsers,
                adminCount,
                employeeCount,
                totalLogs,
                totalDistance: Math.round(totalDistance),
                pendingApps,
            });
        } catch (err) {
            console.error('서비스 통계 로드 실패:', err);
        }
    };

    // 월간 운영 지표
    const loadMonthlyStats = async () => {
        try {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth(); // 0-indexed

            const logSnap = await getDocs(collection(db, 'driveLogs'));
            let monthLogs = 0;
            let monthDistance = 0;
            const activeUserSet = new Set();

            logSnap.docs.forEach(doc => {
                const data = doc.data();
                // timestamp는 Firestore Timestamp 또는 Date 객체
                const ts = data.timestamp?.toDate ? data.timestamp.toDate() : (data.timestamp ? new Date(data.timestamp) : null);
                if (ts && ts.getFullYear() === year && ts.getMonth() === month) {
                    monthLogs++;
                    if (data.distance != null && data.distance > 0) {
                        monthDistance += data.distance;
                    } else {
                        const start = parseFloat(data.startKm) || 0;
                        const end = parseFloat(data.endKm) || 0;
                        if (end > start) monthDistance += (end - start);
                    }
                    if (data.driverUid) activeUserSet.add(data.driverUid);
                }
            });

            setMonthlyStats({
                monthLabel: `${year}년 ${month + 1}월`,
                logs: monthLogs,
                distance: Math.round(monthDistance),
                activeUsers: activeUserSet.size,
            });
        } catch (err) {
            console.error('월간 통계 로드 실패:', err);
        }
    };

    // 기관별 활성도 TOP 10
    const loadTopOrganizations = async () => {
        try {
            const [orgSnap, logSnap, userSnap, vehicleSnap] = await Promise.all([
                getDocs(collection(db, 'organizations')),
                getDocs(collection(db, 'driveLogs')),
                getDocs(collection(db, 'users')),
                getDocs(collection(db, 'vehicles')),
            ]);

            const orgMap = {};
            orgSnap.docs.forEach(doc => {
                const data = doc.data();
                // 삭제된 기관 제외
                if (data.deletedAt) return;
                orgMap[doc.id] = { id: doc.id, name: data.name || '이름 없음', logs: 0, users: 0, vehicles: 0, distance: 0, lastDriveDate: null };
            });

            logSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.organizationId && orgMap[data.organizationId]) {
                    orgMap[data.organizationId].logs++;
                    if (data.distance != null && data.distance > 0) {
                        orgMap[data.organizationId].distance += data.distance;
                    } else {
                        const start = parseFloat(data.startKm) || 0;
                        const end = parseFloat(data.endKm) || 0;
                        if (end > start) orgMap[data.organizationId].distance += (end - start);
                    }
                    // 최근 운행일 추적
                    const ts = data.timestamp?.toDate ? data.timestamp.toDate() : (data.timestamp ? new Date(data.timestamp) : null);
                    if (ts) {
                        const prev = orgMap[data.organizationId].lastDriveDate;
                        if (!prev || ts > prev) {
                            orgMap[data.organizationId].lastDriveDate = ts;
                        }
                    }
                }
            });

            userSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.organizationId && orgMap[data.organizationId] && data.role !== 'superAdmin') {
                    orgMap[data.organizationId].users++;
                }
            });

            vehicleSnap.docs.forEach(doc => {
                const data = doc.data();
                if (data.organizationId && orgMap[data.organizationId]) {
                    orgMap[data.organizationId].vehicles++;
                }
            });

            const sorted = Object.values(orgMap)
                .sort((a, b) => b.logs - a.logs);

            setTopOrgs(sorted);
        } catch (err) {
            console.error('기관 활성도 로드 실패:', err);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">서비스 운영 대시보드</h1>
                <button onClick={loadAllStats} className="btn-ghost text-sm flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                    </svg>
                    새로고침
                </button>
            </div>

            {/* 서비스 개요 카드 */}
            {stats && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard
                        label="등록 기관"
                        value={stats.approvedOrgs}
                        unit="개"
                        icon="🏢"
                        color="blue"
                        sub={stats.pendingApps > 0 ? `신청 대기 ${stats.pendingApps}건` : null}
                    />
                    <StatCard
                        label="전체 사용자"
                        value={stats.totalUsers}
                        unit="명"
                        icon="👥"
                        color="green"
                        sub={`관리자 ${stats.adminCount} · 직원 ${stats.employeeCount}`}
                    />
                    <StatCard
                        label="총 운행 횟수"
                        value={stats.totalLogs.toLocaleString()}
                        unit="회"
                        icon="🚗"
                        color="purple"
                    />
                    <StatCard
                        label="총 주행 거리"
                        value={stats.totalDistance.toLocaleString()}
                        unit="km"
                        icon="📏"
                        color="orange"
                    />
                </div>
            )}

            {/* 월간 운영 지표 */}
            {monthlyStats && (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                        📅 {monthlyStats.monthLabel} 운영 지표
                    </h2>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                            <p className="text-2xl font-bold text-primary-600 dark:text-primary-400">{monthlyStats.logs.toLocaleString()}</p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">이번 달 운행</p>
                        </div>
                        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{monthlyStats.distance.toLocaleString()}<span className="text-sm font-normal ml-0.5">km</span></p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">이번 달 주행</p>
                        </div>
                        <div className="text-center p-4 bg-surface-50 dark:bg-surface-800 rounded-xl">
                            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{monthlyStats.activeUsers}</p>
                            <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">활성 사용자</p>
                        </div>
                    </div>
                </div>
            )}

            {/* 기관별 활성도 */}
            {topOrgs.length > 0 && (() => {
                const totalPages = Math.ceil(topOrgs.length / ORG_PAGE_SIZE);
                const pagedOrgs = topOrgs.slice(orgPage * ORG_PAGE_SIZE, (orgPage + 1) * ORG_PAGE_SIZE);
                return (
                    <div className="glass-card p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">🏆 활성도 ({topOrgs.length} 기관)</h2>
                            {totalPages > 1 && (
                                <div className="flex items-center gap-2 text-sm">
                                    <button
                                        onClick={() => setOrgPage(p => Math.max(0, p - 1))}
                                        disabled={orgPage === 0}
                                        className="px-2 py-1 rounded-lg bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors"
                                    >
                                        ←
                                    </button>
                                    <span className="text-surface-500 dark:text-surface-400 min-w-[60px] text-center">
                                        {orgPage + 1} / {totalPages}
                                    </span>
                                    <button
                                        onClick={() => setOrgPage(p => Math.min(totalPages - 1, p + 1))}
                                        disabled={orgPage >= totalPages - 1}
                                        className="px-2 py-1 rounded-lg bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors"
                                    >
                                        →
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-surface-100 dark:border-surface-700 text-surface-500 dark:text-surface-400">
                                        <th className="text-left py-2 px-1.5 sm:px-3 font-medium">#</th>
                                        <th className="text-left py-2 px-1.5 sm:px-3 font-medium"><span className="hidden sm:inline">기관명</span><span className="sm:hidden">🏢</span></th>
                                        <th className="text-right py-2 px-1.5 sm:px-3 font-medium"><span className="hidden sm:inline">사용자</span><span className="sm:hidden">👤</span></th>
                                        <th className="text-right py-2 px-1.5 sm:px-3 font-medium"><span className="hidden sm:inline">차량</span><span className="sm:hidden">🚗</span></th>
                                        <th className="text-right py-2 px-1.5 sm:px-3 font-medium"><span className="hidden sm:inline">운행 횟수</span><span className="sm:hidden">📊</span></th>
                                        <th className="text-right py-2 px-1.5 sm:px-3 font-medium"><span className="hidden sm:inline">최근 운행</span><span className="sm:hidden">📅</span></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pagedOrgs.map((org, i) => {
                                        const rank = orgPage * ORG_PAGE_SIZE + i;
                                        return (
                                            <tr key={org.id} className="border-b border-surface-50 hover:bg-surface-50 dark:bg-surface-800 transition-colors">
                                                <td className="py-2.5 px-1.5 sm:px-3">
                                                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold bg-surface-100 text-surface-500 dark:bg-surface-700 dark:text-surface-400">
                                                        {rank + 1}
                                                    </span>
                                                </td>
                                                <td className="py-2.5 px-1.5 sm:px-3 font-medium text-surface-800 dark:text-surface-200 max-w-[120px] sm:max-w-none truncate">{org.name}</td>
                                                <td className="py-2.5 px-1.5 sm:px-3 text-right text-surface-600 dark:text-surface-400">{org.users}</td>
                                                <td className="py-2.5 px-1.5 sm:px-3 text-right text-surface-600 dark:text-surface-400">{org.vehicles}</td>
                                                <td className="py-2.5 px-1.5 sm:px-3 text-right text-surface-600 dark:text-surface-400">{org.logs.toLocaleString()}</td>
                                                <td className="py-2.5 px-1.5 sm:px-3 text-right text-surface-600 dark:text-surface-400">
                                                    {org.lastDriveDate
                                                        ? `${org.lastDriveDate.getMonth() + 1}/${org.lastDriveDate.getDate()}`
                                                        : '-'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

function StatCard({ label, value, unit, icon, color, sub }) {
    const colorMap = {
        blue: 'from-blue-50 to-blue-100 border-blue-200 dark:from-blue-950/50 dark:to-blue-900/30 dark:border-blue-800/50',
        green: 'from-emerald-50 to-emerald-100 border-emerald-200 dark:from-emerald-950/50 dark:to-emerald-900/30 dark:border-emerald-800/50',
        purple: 'from-purple-50 to-purple-100 border-purple-200 dark:from-purple-950/50 dark:to-purple-900/30 dark:border-purple-800/50',
        orange: 'from-orange-50 to-orange-100 border-orange-200 dark:from-orange-950/50 dark:to-orange-900/30 dark:border-orange-800/50',
    };

    return (
        <div className={`rounded-2xl border p-4 bg-gradient-to-br ${colorMap[color] || colorMap.blue}`}>
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-surface-500 dark:text-surface-400">{label}</span>
                <span className="text-lg">{icon}</span>
            </div>
            <p className="text-2xl font-bold text-surface-800 dark:text-surface-100">
                {value}<span className="text-sm font-normal text-surface-400 dark:text-surface-400 ml-1">{unit}</span>
            </p>
            {sub && <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">{sub}</p>}
        </div>
    );
}
