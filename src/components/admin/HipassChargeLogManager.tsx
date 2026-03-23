/**
 * HipassChargeLogManager — 관리자용 하이패스 충전 기록 관리 페이지
 * FuelLogManager.tsx 패턴 기반
 */
import useHipassChargeAdmin from '../../hooks/useHipassChargeAdmin';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { getOrganization } from '../../lib/firestore';
import type { Organization } from '../../types/organization';
import { SkeletonBox, SkeletonList } from '../common/Skeleton';
import { useState, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell
} from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316'];

export default function HipassChargeLogManager() {
    const {
        vehicles, loading,
        filters, setFilters, resetFilters,
        filteredRecords, totalChargeAmount,
        monthlyTrend, cardStats, vehicleStats,
        handleDelete,
    } = useHipassChargeAdmin();
    const [showStats, setShowStats] = useState(false);
    const { userData } = useAuth();
    const { showToast } = useToast();
    const [org, setOrg] = useState<Organization | null>(null);
    const orgName = org?.name || '';

    useEffect(() => {
        if (!userData?.organizationId) return;
        getOrganization(userData.organizationId).then((o) => {
            if (o) setOrg(o as Organization);
        });
    }, [userData?.organizationId]);

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto animate-fade-in">
                <SkeletonBox className="h-7 w-36 mb-1" />
                <SkeletonBox className="h-4 w-24 mb-6" />
                <SkeletonList count={4} />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            {/* 헤더 */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">하이패스일지</h1>
                    <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
                        {filteredRecords.length}건
                        {totalChargeAmount > 0 && ` · 총 ${totalChargeAmount.toLocaleString()}원`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={async () => {
                            const { downloadHipassChargesExcel } = await import('../../lib/excelExport');
                            await downloadHipassChargesExcel(filteredRecords, `하이패스충전기록_${orgName || '전체'}`, {
                                onError: (msg) => showToast(msg, 'warning'),
                            });
                        }}
                        disabled={filteredRecords.length === 0}
                        className="btn-secondary btn-sm flex items-center gap-2 disabled:opacity-50"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                        엑셀
                    </button>
                    <button
                        onClick={async () => {
                            const { downloadHipassChargePdf } = await import('../../lib/hipassChargePdfExport');
                            const defaultApproval = [{ title: '담당' }, { title: '팀장' }];
                            const useApproval = org?.hideApprovalLine
                                ? []
                                : ((org?.approvalLine?.length ?? 0) > 0 ? org!.approvalLine! : defaultApproval);
                            downloadHipassChargePdf(filteredRecords, {
                                orgName,
                                approvalLine: useApproval,
                                onError: (msg) => showToast(msg, 'error'),
                            });
                        }}
                        disabled={filteredRecords.length === 0}
                        className="btn-primary btn-sm flex items-center gap-2 disabled:opacity-50"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                        PDF
                    </button>
                </div>
            </div>

            {/* 검색/필터 바 */}
            <div className="glass-card p-4 mb-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                        type="text"
                        value={filters.search}
                        onChange={e => setFilters({ ...filters, search: e.target.value })}
                        className="input"
                        placeholder="🔍 검색 (차량, 충전자, 하이패스 카드)"
                    />
                    <select
                        value={filters.vehicleId}
                        onChange={e => setFilters({ ...filters, vehicleId: e.target.value })}
                        className="input"
                    >
                        <option value="">전체 차량</option>
                        {vehicles.map(v => (
                            <option key={v.id} value={v.id}>{v.displayName}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-2 mt-3">
                    <span className="text-xs text-surface-400 whitespace-nowrap">기간</span>
                    <input
                        type="date"
                        value={filters.startDate}
                        onChange={e => setFilters({ ...filters, startDate: e.target.value })}
                        className="input text-sm flex-1"
                    />
                    <span className="text-surface-300">~</span>
                    <input
                        type="date"
                        value={filters.endDate}
                        onChange={e => setFilters({ ...filters, endDate: e.target.value })}
                        className="input text-sm flex-1"
                    />
                    {(filters.search || filters.vehicleId || filters.startDate || filters.endDate) && (
                        <button
                            onClick={resetFilters}
                            className="text-xs text-surface-400 hover:text-red-500 whitespace-nowrap"
                        >
                            초기화
                        </button>
                    )}
                </div>
            </div>

            {/* 통계 토글 버튼 */}
            {filteredRecords.length > 0 && (
                <div className="flex justify-end mb-4">
                    <button
                        onClick={() => setShowStats(!showStats)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                            showStats
                                ? 'bg-primary-600 text-white shadow-md'
                                : 'bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-600'
                        }`}
                    >
                        📊 {showStats ? '통계 숨기기' : '통계 보기'}
                    </button>
                </div>
            )}

            {/* 통계 대시보드 */}
            {showStats && filteredRecords.length > 0 && (
                <div className="space-y-4 mb-6 animate-fade-in">
                    {/* 월별 충전 추세 */}
                    {monthlyTrend.length > 1 && (
                        <div className="glass-card p-5">
                            <h2 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">📈 월별 충전 추세</h2>
                            <div className="w-full">
                                <ResponsiveContainer width="100%" height={220} minWidth={1} minHeight={1}>
                                    <BarChart data={monthlyTrend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} />
                                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
                                        <Tooltip formatter={(value) => [`${(value as number).toLocaleString()}원`, '충전액']} />
                                        <Bar dataKey="amount" fill="#8b5cf6" radius={[6, 6, 0, 0]} barSize={32} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* 카드별 사용량 */}
                        {cardStats.length > 0 && (
                            <div className="glass-card p-5">
                                <h2 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">💳 카드별 사용량</h2>
                                <div className="w-full">
                                    <ResponsiveContainer width="100%" height={220} minWidth={1} minHeight={1}>
                                        <PieChart>
                                            <Pie
                                                data={cardStats}
                                                cx="50%" cy="50%"
                                                innerRadius={50} outerRadius={85} paddingAngle={3}
                                                dataKey="amount" nameKey="name"
                                                label={({ name, percent }) => `${(name ?? '').length > 8 ? (name ?? '').slice(-4) : (name ?? '')} ${((percent ?? 0) * 100).toFixed(0)}%`}
                                            >
                                                {cardStats.map((_, index) => (
                                                    <Cell key={`card-${index}`} fill={COLORS[index % COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip formatter={(value) => `${(value as number).toLocaleString()}원`} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

                        {/* 차량별 충전 금액 */}
                        {vehicleStats.length > 0 && (
                            <div className="glass-card p-5">
                                <h2 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">🚗 차량별 충전 금액</h2>
                                <div className="space-y-2">
                                    {vehicleStats.map((v, i) => (
                                        <div key={i} className="flex items-center justify-between text-sm">
                                            <div className="flex items-center gap-2">
                                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                                                <span className="text-surface-700 dark:text-surface-300 truncate max-w-[140px]">{v.name}</span>
                                            </div>
                                            <div className="text-right">
                                                <span className="font-semibold text-surface-900 dark:text-surface-100">{v.amount.toLocaleString()}원</span>
                                                <span className="text-xs text-surface-400 ml-1.5">({v.count}건)</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 기록 목록 */}
            {filteredRecords.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">🛣️</div>
                    <p className="text-surface-400 font-medium">하이패스 충전 기록이 없습니다</p>
                    <p className="text-sm text-surface-300 mt-1">직원이 하이패스 충전 기록을 등록하면 여기에 표시됩니다</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {/* 헤더 (데스크탑) */}
                    <div className="hidden sm:grid gap-2 px-4 py-2 text-xs font-medium text-surface-400" style={{ gridTemplateColumns: '2fr 1fr 1.5fr 2fr 2fr 1.5fr 1.5fr 40px' }}>
                        <div>날짜</div>
                        <div>시각</div>
                        <div>충전자</div>
                        <div>차량</div>
                        <div>하이패스 카드</div>
                        <div className="text-right">충전금액</div>
                        <div className="text-right">충전후잔액</div>
                        <div></div>
                    </div>

                    {filteredRecords.map(rec => {
                        const dateStr = rec.date || '-';
                        const ca = rec.createdAt;
                        const timeDate = (ca && typeof ca === 'object' && 'toDate' in ca && typeof (ca as { toDate?: unknown }).toDate === 'function')
                            ? (ca as { toDate: () => Date }).toDate()
                            : (ca instanceof Date ? ca : null);
                        const timeStr = timeDate
                            ? timeDate.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
                            : '';
                        return (
                            <div key={rec.id} className="glass-card p-4 hover:shadow-glass-lg transition-all">
                                {/* 모바일 */}
                                <div className="sm:hidden">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-sm text-surface-900 dark:text-surface-100">{rec.chargerName}</span>
                                            <span className="text-xs text-surface-400">{dateStr} {timeStr}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-blue-600 dark:text-blue-400">{rec.chargeAmount?.toLocaleString()}원</span>
                                            <button
                                                onClick={() => handleDelete(rec)}
                                                className="p-1.5 rounded-lg text-surface-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                                title="삭제"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
                                        <span>{rec.vehicleName}</span>
                                        <span>·</span>
                                        <span>{rec.cardNumber}</span>
                                        <span>·</span>
                                        <span>잔액 {rec.balanceAfter?.toLocaleString()}원</span>
                                    </div>
                                </div>

                                {/* 데스크탑 */}
                                <div className="hidden sm:grid gap-2 items-center" style={{ gridTemplateColumns: '2fr 1fr 1.5fr 2fr 2fr 1.5fr 1.5fr 40px' }}>
                                    <div>
                                        <p className="text-sm text-surface-900 dark:text-surface-100">{dateStr}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-mono text-surface-500 dark:text-surface-400">{timeStr || '-'}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-surface-900 dark:text-surface-100 truncate">{rec.chargerName}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-surface-700 dark:text-surface-300 truncate">{rec.vehicleName}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-mono text-surface-500 dark:text-surface-400 truncate">{rec.cardNumber}</p>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{rec.chargeAmount?.toLocaleString()}원</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-xs font-mono text-surface-500 dark:text-surface-400">{rec.balanceAfter?.toLocaleString()}원</span>
                                    </div>
                                    <div className="text-center">
                                        <button
                                            onClick={() => handleDelete(rec)}
                                            className="p-1.5 rounded-lg text-surface-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                            title="삭제"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
