/**
 * MaintenanceLog — 차량 정비 기록 페이지
 * 로직은 useMaintenanceLog 훅 사용
 */
import useMaintenanceLog, { MAINTENANCE_TYPES } from '../../hooks/useMaintenanceLog';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { getOrganization } from '../../lib/firestore';
import type { Organization } from '../../types/organization';
import { isVehicleBlocked } from '../../lib/vehicleUtils';
import { SkeletonBox, SkeletonList } from '../common/Skeleton';
import MaintenanceForm from './maintenanceLog/MaintenanceForm';
import MaintenanceFilters from './maintenanceLog/MaintenanceFilters';
import MaintenanceRecordCard from './maintenanceLog/MaintenanceRecordCard';
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
                <MaintenanceForm
                    form={form}
                    setForm={setForm}
                    vehicles={vehicles}
                    editingId={editingId}
                    saving={saving}
                    onSubmit={handleSubmit}
                    onVehicleSelect={handleVehicleSelect}
                    onCancelEdit={handleCancelEdit}
                />
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
            <MaintenanceFilters
                filters={filters}
                setFilters={setFilters}
                vehicles={vehicles}
                resetFilters={resetFilters}
            />

            {/* 기록 목록 */}
            {filteredRecords.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">🔧</div>
                    <p className="text-surface-400 font-medium">정비 기록이 없습니다</p>
                    <p className="text-sm text-surface-300 mt-1">위의 버튼으로 새 기록을 추가하세요</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {filteredRecords.map(rec => (
                        <MaintenanceRecordCard
                            key={rec.id}
                            record={rec}
                            getTypeInfo={getTypeInfo}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
