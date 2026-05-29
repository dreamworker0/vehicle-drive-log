import React, { lazy, Suspense } from 'react';
import { useToast } from '../../../hooks/useToast';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { updateOrganization } from '../../../lib/firestore';
import app from '../../../lib/firebase';
import { ORG_PAGE_SIZE } from './dashboardUtils';
import type { OrgData, SortKey } from './dashboardUtils';

const OrgMapView = lazy(() => import('../OrgMapView'));

interface Props {
    topOrgs: OrgData[];
    sortedOrgs: OrgData[];
    orgPage: number;
    setOrgPage: (fn: (p: number) => number) => void;
    sortKey: SortKey;
    sortDir: 'asc' | 'desc';
    handleSort: (key: SortKey) => void;
    sortIndicator: (key: SortKey) => React.ReactNode;
    onRefresh: () => void;
}

function DashboardOrgTable({
    topOrgs,
    sortedOrgs,
    orgPage,
    setOrgPage,
    handleSort,
    sortIndicator,
    onRefresh,
}: Props) {
    const { showToast } = useToast();
    const [hiddenOrgIds, setHiddenOrgIds] = React.useState<Set<string>>(new Set());

    if (!sortedOrgs || sortedOrgs.length === 0) {
        return (
            <div className="glass-card p-5">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">🏆 활성도</h2>
                </div>
                <div className="flex flex-col items-center justify-center py-12 text-surface-400">최근 발생한 데이터가 없습니다.</div>
            </div>
        );
    }

    const totalPages = Math.ceil(sortedOrgs.length / ORG_PAGE_SIZE);
    const pagedOrgs = sortedOrgs.slice(orgPage * ORG_PAGE_SIZE, (orgPage + 1) * ORG_PAGE_SIZE);

    return (
        <>
            {/* ── 기관별 활성도 ── */}
            <div className="glass-card p-5">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">🏆 활성도 ({sortedOrgs.length} 기관)</h2>
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
                                <th className="text-left py-2 px-1.5 sm:px-3 font-medium text-surface-500 dark:text-surface-400 cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" onClick={() => handleSort('name')}>
                                    <span className="hidden sm:inline">기관명</span><span className="sm:hidden">🏢</span>{sortIndicator('name')}
                                </th>
                                <th className="text-right py-2 px-1.5 sm:px-3 font-medium text-surface-500 dark:text-surface-400 cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" onClick={() => handleSort('users')}>
                                    <span className="hidden sm:inline">사용자</span><span className="sm:hidden">👤</span>{sortIndicator('users')}
                                </th>
                                <th className="text-right py-2 px-1.5 sm:px-3 font-medium text-surface-500 dark:text-surface-400 cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" onClick={() => handleSort('vehicles')}>
                                    <span className="hidden sm:inline">차량</span><span className="sm:hidden">🚗</span>{sortIndicator('vehicles')}
                                </th>
                                <th className="text-right py-2 px-1.5 sm:px-3 font-medium text-surface-500 dark:text-surface-400 cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" onClick={() => handleSort('logs')}>
                                    <span className="hidden sm:inline">운행 횟수</span><span className="sm:hidden">📊</span>{sortIndicator('logs')}
                                </th>
                                <th className="text-right py-2 px-1.5 sm:px-3 font-medium text-surface-500 dark:text-surface-400 cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200 transition-colors" onClick={() => handleSort('lastDriveDate')}>
                                    <span className="hidden sm:inline">최근 운행</span><span className="sm:hidden">📅</span>{sortIndicator('lastDriveDate')}
                                </th>
                                <th className="text-center py-2 px-1.5 sm:px-3 font-medium hidden sm:table-cell">온보딩</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pagedOrgs.map((org, i) => {
                                const rank = orgPage * ORG_PAGE_SIZE + i;
                                const onboarded = org.users > 0 && org.vehicles > 0 && org.logs > 0;
                                return (
                                    <tr key={org.id} className="border-b border-surface-50 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors">
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
                                        <td className="py-2.5 px-1.5 sm:px-3 text-center hidden sm:table-cell">
                                            {onboarded
                                                ? <span className="text-emerald-500">✅</span>
                                                : <span className="text-surface-300 dark:text-surface-600">○</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── 기관 위치 지도 ── */}
            {topOrgs.filter(o => o.lat && o.lng).length > 0 && (
                <Suspense fallback={
                    <div className="glass-card p-5">
                        <div className="flex items-center justify-center py-10 gap-2 text-sm text-surface-400">
                            <div className="w-4 h-4 spinner" /> 지도 로딩 중...
                        </div>
                    </div>
                }>
                    <OrgMapView orgs={topOrgs.filter(o => o.lat && o.lng).map(o => ({ id: o.id, name: o.name, address: o.address, lat: o.lat, lng: o.lng }))} />
                </Suspense>
            )}

            {/* 좌표 없는 기관 리스트 + 수동 입력 */}
            {topOrgs.filter(o => o.address && (!o.lat || !o.lng) && !hiddenOrgIds.has(o.id)).length > 0 && (
                <div className="glass-card p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">
                            📡 좌표 미등록 기관 ({topOrgs.filter(o => o.address && (!o.lat || !o.lng) && !hiddenOrgIds.has(o.id)).length}개)
                        </h2>
                        <button
                            className="px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50"
                            onClick={async (e) => {
                                const btn = e.currentTarget;
                                btn.disabled = true;
                                btn.textContent = '변환 중...';
                                try {
                                    const functions = getFunctions(app, 'asia-northeast3');
                                    const backfill = httpsCallable(functions, 'backfillOrgCoords');
                                    const result = await backfill() as { data: { updated: number } };
                                    btn.textContent = `✅ ${result.data.updated}개 완료`;
                                    setTimeout(() => window.location.reload(), 2000);
                                } catch (err: unknown) {
                                    btn.textContent = '❌ 실패';
                                    showToast('자동 변환 실패: ' + (err instanceof Error ? err.message : '알 수 없는 오류'), 'error');
                                    btn.disabled = false;
                                }
                            }}
                        >
                            전체 자동 변환
                        </button>
                    </div>
                    <div className="space-y-3">
                        {topOrgs.filter(o => o.address && (!o.lat || !o.lng) && !hiddenOrgIds.has(o.id)).map(org => (
                            <div key={org.id} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 bg-surface-50 dark:bg-surface-800 rounded-xl">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-surface-800 dark:text-surface-200 truncate">{org.name}</p>
                                    <p className="text-xs text-surface-400 truncate">{org.address}</p>
                                </div>
                                <form
                                    className="flex items-center gap-2 shrink-0"
                                    onSubmit={async (e) => {
                                        e.preventDefault();
                                        const form = e.currentTarget;
                                        const latInput = form.querySelector<HTMLInputElement>('input[name="lat"]')!;
                                        const lngInput = form.querySelector<HTMLInputElement>('input[name="lng"]')!;
                                        const btn = form.querySelector<HTMLButtonElement>('button')!;
                                        const lat = parseFloat(latInput.value);
                                        const lng = parseFloat(lngInput.value);
                                        if (!lat || !lng || lat < 33 || lat > 43 || lng < 124 || lng > 132) {
                                            showToast('올바른 한국 좌표를 입력하세요. 위도: 33~43, 경도: 124~132', 'error');
                                            return;
                                        }
                                        btn.disabled = true;
                                        btn.textContent = '저장 중...';
                                        try {
                                            await updateOrganization(org.id, { lat, lng });
                                            setHiddenOrgIds(prev => new Set([...prev, org.id]));
                                            showToast(`${org.name} 좌표가 저장되었습니다.`, 'success');
                                            onRefresh();
                                        } catch (err: unknown) {
                                            btn.textContent = '❌';
                                            showToast('저장 실패: ' + (err instanceof Error ? err.message : '알 수 없는 오류'), 'error');
                                            btn.disabled = false;
                                        }
                                    }}
                                >
                                    <input name="lat" type="number" step="any" placeholder="위도 (lat)" className="w-24 px-2 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-700 text-surface-800 dark:text-surface-200" />
                                    <input name="lng" type="number" step="any" placeholder="경도 (lng)" className="w-24 px-2 py-1.5 text-xs rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-700 text-surface-800 dark:text-surface-200" />
                                    <button type="submit" className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 rounded-lg transition-colors disabled:opacity-50">
                                        저장
                                    </button>
                                </form>
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-surface-400 mt-3">
                        💡 Google Maps에서 주소를 검색한 후 좌표를 복사하여 입력하세요
                    </p>
                </div>
            )}

            {/* 주소 없는 기관 표시 */}
            {topOrgs.filter(o => !o.address).length > 0 && (
                <div className="glass-card p-4">
                    <p className="text-sm text-surface-500 dark:text-surface-400 mb-2">
                        ⚠️ 주소 미등록 기관 ({topOrgs.filter(o => !o.address).length}개)
                    </p>
                    <div className="space-y-1">
                        {topOrgs.filter(o => !o.address).map(org => (
                            <p key={org.id} className="text-xs text-surface-400 pl-4">
                                • {org.name}
                            </p>
                        ))}
                    </div>
                    <p className="text-xs text-surface-400 mt-2">
                        기관 관리에서 해당 기관의 주소를 입력하면 좌표 변환이 가능합니다.
                    </p>
                </div>
            )}
        </>
    );
}

export default React.memo(DashboardOrgTable);
