/**
 * MaintenanceLog — 차량 정비 기록 페이지
 * 로직은 useMaintenanceLog 훅 사용
 */
import useMaintenanceLog, { MAINTENANCE_TYPES } from '../../hooks/useMaintenanceLog';
import { useToast } from '../../hooks/useToast';
import useAdminLogExport from '../../hooks/useAdminLogExport';
import { isVehicleBlocked } from '../../lib/vehicleUtils';
import { SkeletonBox, SkeletonList } from '../common/Skeleton';
import LogExportButtons from './LogExportButtons';
import MaintenanceForm from './maintenanceLog/MaintenanceForm';
import MaintenanceFilters from './maintenanceLog/MaintenanceFilters';
import MaintenanceRecordCard from './maintenanceLog/MaintenanceRecordCard';

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
    const { showToast } = useToast();
    const { orgName, approvalLine, runExcel, runPdf } = useAdminLogExport();

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
                    <button onClick={() => { if (showForm) { handleCancelEdit(); } else { setShowForm(true); } }} className="btn-primary btn-sm flex items-center gap-1 min-h-[48px]">
                        {showForm ? '✕ 닫기' : '＋ 정비 기록 추가'}
                    </button>
                    <LogExportButtons
                        disabled={filteredRecords.length === 0}
                        onExcel={() => runExcel(async () => {
                            const { downloadMaintenanceExcel } = await import('../../lib/excelExport');
                            await downloadMaintenanceExcel(filteredRecords, `정비기록_${orgName || '전체'}`, {
                                onError: (msg) => showToast(msg, 'warning'),
                                typeLabels: TYPE_LABELS,
                            });
                        })}
                        onPdf={() => runPdf(async () => {
                            const { downloadMaintenancePdf } = await import('../../lib/pdf/maintenancePdfExport');
                            downloadMaintenancePdf(filteredRecords, {
                                orgName,
                                typeLabels: TYPE_LABELS,
                                approvalLine,
                                onError: (msg) => showToast(msg, 'error'),
                            });
                        })}
                    />
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
                                        {v.maintenance?.endDate && <span className="text-surface-400 dark:text-surface-500"> (~{v.maintenance.endDate.slice(5)})</span>}
                                    </span>
                                    <button
                                        onClick={() => handleClearBlock(v.id)}
                                        className="text-amber-600 hover:text-green-600 dark:text-amber-400 dark:hover:text-green-400 font-bold transition-colors min-h-[48px] px-2 py-1"
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
                    <p className="text-surface-400 dark:text-surface-500 font-medium">정비 기록이 없습니다</p>
                    <p className="text-sm text-surface-300 dark:text-surface-600 mt-1">위의 버튼으로 새 기록을 추가하세요</p>
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
