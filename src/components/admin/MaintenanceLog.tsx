/**
 * MaintenanceLog — 차량 정비 기록 페이지
 * 로직은 useMaintenanceLog 훅 사용
 */
import useMaintenanceLog, { MAINTENANCE_TYPES } from '../../hooks/useMaintenanceLog';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { getOrganization } from '../../lib/firestore';
import type { Organization } from '../../types/organization';
import { VEHICLE_TYPE_ICONS } from '../../lib/constants';
import { isVehicleBlocked } from '../../lib/vehicleUtils';
import { SkeletonBox, SkeletonList } from '../common/Skeleton';
import { useState, useEffect } from 'react';

/** type 값 → 한글 라벨 매핑 */
const TYPE_LABELS: Record<string, string> = Object.fromEntries(
    MAINTENANCE_TYPES.map(t => [t.value, t.label]),
);

export default function MaintenanceLog() {
    const {
        vehicles, loading, showForm, setShowForm,
        saving, filters, setFilters, resetFilters,
        form, setForm, filteredRecords, editingId,
        handleSubmit, handleEdit, handleCancelEdit, handleDelete, getTypeInfo, handleVehicleSelect,
        handleClearBlock,
    } = useMaintenanceLog();
    const { userData } = useAuth();
    const { showToast } = useToast();
    const [org, setOrg] = useState<Organization | null>(null);
    const orgName = org?.name || '';

    useEffect(() => {
        if (!userData?.organizationId) return;
        getOrganization(userData.organizationId).then((o) => {
            if (o) setOrg(o as Organization);
        }).catch(err => console.error('getOrganization failed:', err));
    }, [userData?.organizationId]);

    const blockedVehicles = vehicles.filter(v => isVehicleBlocked(v.maintenance));
    const totalCost = filteredRecords.reduce((sum, r) => sum + (r.cost || 0), 0);

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
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">차량 정비 기록</h1>
                    <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
                        {filteredRecords.length}건{totalCost > 0 && ` · 총 ${totalCost.toLocaleString()}원`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => { if (showForm) { handleCancelEdit(); } else { setShowForm(true); } }} className="btn-primary btn-sm flex items-center gap-1">
                        {showForm ? '✕ 닫기' : '＋ 정비 기록 추가'}
                    </button>
                    <button
                        onClick={async () => {
                            try {
                                const { downloadMaintenanceExcel } = await import('../../lib/excelExport');
                                await downloadMaintenanceExcel(filteredRecords, `정비기록_${orgName || '전체'}`, {
                                    onError: (msg) => showToast(msg, 'warning'),
                                    typeLabels: TYPE_LABELS,
                                });
                            } catch (err) {
                                console.error('엑셀 다운로드 실패:', err);
                                showToast('엑셀 다운로드 중 오류가 발생했습니다.', 'error');
                            }
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
                            try {
                                const { downloadMaintenancePdf } = await import('../../lib/pdf/maintenancePdfExport');
                                const defaultApproval = [{ title: '담당' }, { title: '팀장' }];
                                const useApproval = org?.hideApprovalLine
                                    ? []
                                    : ((org?.approvalLine?.length ?? 0) > 0 ? org!.approvalLine! : defaultApproval);
                                downloadMaintenancePdf(filteredRecords, {
                                    orgName,
                                    typeLabels: TYPE_LABELS,
                                    approvalLine: useApproval,
                                    onError: (msg) => showToast(msg, 'error'),
                                });
                            } catch (err) {
                                console.error('PDF 다운로드 실패:', err);
                                showToast('PDF 다운로드 중 오류가 발생했습니다.', 'error');
                            }
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

            {/* 등록 폼 */}
            {showForm && (
                <form onSubmit={handleSubmit} className="glass-card p-5 mb-6 space-y-4 animate-fade-in">
                    <h2 className="font-semibold text-surface-800 dark:text-surface-200">{editingId ? '정비 기록 수정' : '새 정비 기록'}</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="label">차량 <span className="text-red-500">*</span></label>
                            <select value={form.vehicleId} onChange={e => handleVehicleSelect(e.target.value)} className="input" required>
                                <option value="">선택</option>
                                {vehicles.map(v => (<option key={v.id} value={v.id}>{v.displayName}</option>))}
                            </select>
                        </div>
                        <div>
                            <label className="label">날짜 <span className="text-red-500">*</span></label>
                            <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="input" required />
                        </div>
                    </div>
                    <div>
                        <label className="label">정비 유형 <span className="text-red-500">*</span></label>
                        <div className="flex flex-wrap gap-1.5">
                            {MAINTENANCE_TYPES.map(t => (
                                <button key={t.value} type="button" onClick={() => setForm({ ...form, type: t.value })}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${form.type === t.value
                                        ? 'bg-primary-100 border-primary-300 text-primary-700 ring-1 ring-primary-200'
                                        : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-primary-300'}`}>
                                    {t.icon} {t.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="label">비용 (원)</label>
                            <input type="number" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} className="input" placeholder="50000" />
                        </div>
                        <div>
                            <label className="label">정비소</label>
                            <input type="text" value={form.shop} onChange={e => setForm({ ...form, shop: e.target.value })} className="input" placeholder="OO정비소" />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <label className="label">현재 km</label>
                            <input type="number" value={form.km} onChange={e => setForm({ ...form, km: e.target.value })} className="input" placeholder="45000" />
                        </div>
                        <div>
                            <label className="label">다음 정비 km</label>
                            <input type="number" value={form.nextDueKm} onChange={e => setForm({ ...form, nextDueKm: e.target.value })} className="input" placeholder="50000" />
                        </div>
                        <div>
                            <label className="label">다음 정비일</label>
                            <input type="date" value={form.nextDueDate} onChange={e => setForm({ ...form, nextDueDate: e.target.value })} className="input" />
                        </div>
                    </div>
                    <div>
                        <label className="label">메모</label>
                        <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="input min-h-[60px] resize-none" placeholder="정비 내용을 간략히 작성하세요" rows={2} />
                    </div>

                    {/* 차량 사용 차단 토글 */}
                    <div className="border-t border-surface-200 dark:border-surface-700 pt-4">
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.blockVehicle}
                                onChange={e => setForm({ ...form, blockVehicle: e.target.checked })}
                                className="w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                            />
                            <div>
                                <span className="text-sm font-medium text-surface-800 dark:text-surface-200">🚫 정비 기간 중 차량 사용 차단</span>
                                <p className="text-xs text-surface-400 mt-0.5">활성화 시 이 차량의 예약 및 운행이 차단됩니다</p>
                            </div>
                        </label>
                        {form.blockVehicle && (
                            <div className="mt-3 ml-7">
                                <label className="label">차단 종료 예정일</label>
                                <input
                                    type="date"
                                    value={form.blockEndDate}
                                    onChange={e => setForm({ ...form, blockEndDate: e.target.value })}
                                    className="input max-w-[200px]"
                                    min={form.date}
                                />
                                <p className="text-xs text-surface-400 mt-1">종료 예정일이 지나면 자동으로 차단이 해제됩니다</p>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-2">
                        {editingId && (
                            <button type="button" onClick={handleCancelEdit} className="btn-secondary">취소</button>
                        )}
                        <button type="submit" disabled={saving} className="btn-primary">
                            {saving ? '저장 중...' : form.blockVehicle ? (editingId ? '🚫 기록 수정 + 차량 차단' : '🚫 정비 기록 저장 + 차량 차단') : (editingId ? '정비 기록 수정' : '정비 기록 저장')}
                        </button>
                    </div>
                </form>
            )}

            {/* 현재 차단 중인 차량 안내 */}
            {blockedVehicles.length > 0 && (
                <div className="glass-card p-4 mb-4 border-l-4 border-amber-400 animate-fade-in">
                    <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-2">🔧 현재 정비 차단 중인 차량</h3>
                    <div className="flex flex-wrap gap-2">
                        {blockedVehicles.map(v => {
                            const typeInfo = getTypeInfo(v.maintenance?.reason ?? '');
                            return (
                                <div key={v.id} className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 rounded-full text-xs">
                                    <span className="text-amber-700 dark:text-amber-400 font-medium">
                                        {typeInfo.icon} {v.displayName}
                                        {v.maintenance?.endDate && <span className="text-surface-400"> (~{v.maintenance.endDate.slice(5)})</span>}
                                    </span>
                                    <button
                                        onClick={() => handleClearBlock(v.id)}
                                        className="text-amber-600 hover:text-green-600 dark:text-amber-400 dark:hover:text-green-400 font-bold transition-colors"
                                        title="정비 완료 (차단 해제)"
                                    >
                                        ✓ 해제
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 검색/필터 바 */}
            <div className="glass-card p-4 mb-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                        type="text"
                        value={filters.search}
                        onChange={e => setFilters({ ...filters, search: e.target.value })}
                        className="input"
                        placeholder="🔍 검색 (차량, 정비소, 메모)"
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
                    <select
                        value={filters.type}
                        onChange={e => setFilters({ ...filters, type: e.target.value })}
                        className="input"
                    >
                        <option value="">전체 유형</option>
                        {MAINTENANCE_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                        ))}
                    </select>
                </div>
                {/* 기간 필터 */}
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
                    {(filters.search || filters.vehicleId || filters.type || filters.startDate || filters.endDate) && (
                        <button
                            onClick={resetFilters}
                            className="text-xs text-surface-400 hover:text-red-500 whitespace-nowrap"
                        >
                            초기화
                        </button>
                    )}
                </div>
            </div>

            {/* 기록 목록 */}
            {filteredRecords.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">🔧</div>
                    <p className="text-surface-400 font-medium">정비 기록이 없습니다</p>
                    <p className="text-sm text-surface-300 mt-1">위의 버튼으로 새 기록을 추가하세요</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {filteredRecords.map(rec => {
                        const typeInfo = getTypeInfo(rec.type);
                        const vehicleIcon = rec.vehicleType ? (VEHICLE_TYPE_ICONS[rec.vehicleType] || '🚗') : '🚗';
                        return (
                            <div key={rec.id} className="glass-card p-4 flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center text-xl flex-shrink-0">
                                    {vehicleIcon}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-surface-900 dark:text-surface-100">{rec.vehicleName}</span>
                                        <span className="text-xs px-2 py-0.5 bg-surface-100 dark:bg-surface-700 rounded-full text-surface-500 dark:text-surface-400">{typeInfo.icon} {typeInfo.label}</span>
                                    </div>
                                    <p className="text-xs text-surface-400 mt-0.5">
                                        {rec.date}{rec.shop && ` · ${rec.shop}`}{rec.km && ` · ${rec.km.toLocaleString()} km`}
                                    </p>
                                    {rec.description && <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">{rec.description}</p>}
                                    {(rec.nextDueKm || rec.nextDueDate) && (
                                        <p className="text-xs text-amber-600 mt-1">
                                            📅 다음: {rec.nextDueDate || ''} {rec.nextDueKm ? `${rec.nextDueKm.toLocaleString()} km` : ''}
                                        </p>
                                    )}
                                </div>
                                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                    {rec.blockVehicle && (
                                        <span className="text-xs px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full font-medium">🚫 차단</span>
                                    )}
                                    {rec.cost && <span className="text-sm font-bold text-surface-700 dark:text-surface-300">{rec.cost.toLocaleString()}원</span>}
                                    <div className="flex items-center gap-1 mt-1">
                                        <button
                                            onClick={() => handleEdit(rec)}
                                            title="수정"
                                            className="p-1.5 rounded-lg text-surface-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-all"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                            </svg>
                                        </button>
                                        <button
                                            onClick={() => handleDelete(rec)}
                                            title="삭제"
                                            className="p-1.5 rounded-lg text-surface-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
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
