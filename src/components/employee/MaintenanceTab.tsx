/**
 * MaintenanceTab — 직원용 차량 정비 기록 탭 ("차량 관리" 화면의 정비 탭 본문)
 * 직원은 정비 기록을 작성하고 본인이 작성한 기록만 수정ㆍ삭제할 수 있다.
 * 차량 차단(blockVehicle)은 관리자 전용이라 여기에는 노출하지 않는다.
 * 페이지 제목ㆍ탭 전환은 부모(FuelLogTab)가 소유하므로 여기서는 본문만 렌더한다.
 */
import useEmployeeMaintenance from '../../hooks/useEmployeeMaintenance';
import { MAINTENANCE_TYPES } from '../../hooks/useMaintenanceLog';
import { VEHICLE_TYPE_ICONS, getVehicleColor } from '../../lib/constants';
import { SkeletonBox, SkeletonList } from '../common/Skeleton';
import VehicleSelector from './VehicleSelector';
import useVehiclePriority from '../../hooks/useVehiclePriority';

const getTypeInfo = (type: string) =>
    MAINTENANCE_TYPES.find(t => t.value === type) || MAINTENANCE_TYPES[MAINTENANCE_TYPES.length - 1];

export default function MaintenanceTab() {
    const {
        vehicles, loading, showForm, setShowForm,
        saving, form, setForm, enrichedRecords,
        editingId, handleEdit, handleCancelEdit,
        handleSubmit, handleDelete, handleVehicleSelect,
        currentUid,
    } = useEmployeeMaintenance();
    const { usageCounts } = useVehiclePriority();

    if (loading) {
        return (
            <div className="animate-fade-in">
                <SkeletonBox className="h-10 w-full mb-4" />
                <SkeletonList count={3} />
            </div>
        );
    }

    return (
        <div className="animate-fade-in">
            <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                차량 정비ㆍ수리 후 기록을 남겨주세요. 본인이 작성한 기록만 수정ㆍ삭제할 수 있어요.
            </p>

            {/* 헤더 */}
            <div className="flex items-center justify-between mb-4">
                <p className="text-xs text-surface-400 dark:text-surface-500">{enrichedRecords.length}건</p>
                <button
                    onClick={() => {
                        if (showForm) { handleCancelEdit(); } else { setShowForm(true); }
                    }}
                    className="btn-primary btn-sm flex items-center gap-1 min-h-[48px]"
                >
                    {showForm ? '✕ 닫기' : '🔧 정비 기록 등록'}
                </button>
            </div>

            {/* 입력 폼 */}
            {showForm && (
                <form onSubmit={handleSubmit} className="glass-card p-4 mb-4 space-y-3 animate-fade-in">
                    <h2 className="font-semibold text-sm text-surface-800 dark:text-surface-200">
                        {editingId ? '✏️ 정비 기록 수정' : '새 정비 기록'}
                    </h2>

                    {/* 차량 선택 */}
                    <div>
                        <label className="label text-xs">🚘 차량 <span className="text-red-500 dark:text-red-400">*</span></label>
                        <VehicleSelector
                            vehicles={vehicles}
                            selectedVehicleId={form.vehicleId}
                            onSelect={handleVehicleSelect}
                            usageCounts={usageCounts}
                        />
                    </div>

                    {/* 날짜 */}
                    <div>
                        <label className="label text-xs">📅 날짜 <span className="text-red-500 dark:text-red-400">*</span></label>
                        <input
                            type="date"
                            value={form.date}
                            onChange={e => setForm({ ...form, date: e.target.value })}
                            className="input min-h-[48px]"
                            required
                        />
                    </div>

                    {/* 정비 유형 */}
                    <div>
                        <label className="label text-xs">🛠️ 유형 <span className="text-red-500 dark:text-red-400">*</span></label>
                        <div className="grid grid-cols-3 gap-1.5">
                            {MAINTENANCE_TYPES.map(t => (
                                <button
                                    key={t.value}
                                    type="button"
                                    onClick={() => setForm({ ...form, type: t.value })}
                                    className={`p-2 min-h-[48px] rounded-lg border text-xs font-medium transition-all flex flex-col items-center gap-1 ${
                                        form.type === t.value
                                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 ring-2 ring-primary-500/30 dark:ring-primary-400/30 text-surface-900 dark:text-surface-100'
                                            : 'border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:border-surface-300 dark:hover:border-surface-500'
                                    }`}
                                >
                                    <span className="text-base">{t.icon}</span>
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 내용 */}
                    <div>
                        <label className="label text-xs">📝 내용</label>
                        <textarea
                            value={form.description}
                            onChange={e => setForm({ ...form, description: e.target.value })}
                            className="input min-h-[60px] resize-none"
                            placeholder="정비ㆍ수리 내용을 입력해주세요"
                            rows={2}
                        />
                    </div>

                    {/* 비용 + 주행거리 */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="label text-xs">💰 비용 (원)</label>
                            <input
                                type="number"
                                min="0"
                                value={form.cost}
                                onChange={e => setForm({ ...form, cost: e.target.value })}
                                className="input min-h-[48px]"
                                placeholder="50000"
                            />
                        </div>
                        <div>
                            <label className="label text-xs">🔢 주행거리 (km)</label>
                            <input
                                type="number"
                                min="0"
                                value={form.km}
                                onChange={e => setForm({ ...form, km: e.target.value })}
                                className="input min-h-[48px]"
                                placeholder="45000"
                            />
                        </div>
                    </div>

                    {/* 정비소 */}
                    <div>
                        <label className="label text-xs">🏪 정비소</label>
                        <input
                            type="text"
                            value={form.shop}
                            onChange={e => setForm({ ...form, shop: e.target.value })}
                            className="input min-h-[48px]"
                            placeholder="정비소 이름 (선택)"
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                        {editingId && (
                            <button type="button" onClick={handleCancelEdit} className="btn-secondary btn-sm min-h-[48px]">
                                취소
                            </button>
                        )}
                        <button type="submit" disabled={saving} className="btn-primary btn-sm min-h-[48px]">
                            {saving ? '저장 중...' : editingId ? '수정 완료' : '정비 기록 저장'}
                        </button>
                    </div>
                </form>
            )}

            {/* 기록 리스트 (기관 전체) */}
            {enrichedRecords.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">🔧</div>
                    <p className="text-surface-400 dark:text-surface-500 font-medium">아직 정비 기록이 없어요</p>
                    <p className="text-sm text-surface-300 dark:text-surface-500 mt-1">차량 정비ㆍ수리 후 기록을 남기면 이력을 한눈에 볼 수 있어요</p>
                    {!showForm && (
                        <button
                            onClick={() => setShowForm(true)}
                            className="mt-4 btn-primary btn-sm text-sm min-h-[48px]"
                        >
                            🔧 첫 정비 기록 등록하기
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-2">
                    {enrichedRecords.map(rec => {
                        const vehicleIcon = rec.vehicleType ? (VEHICLE_TYPE_ICONS[rec.vehicleType] || '🚗') : '🚗';
                        const typeInfo = getTypeInfo(rec.type);
                        const isOwn = rec.createdByUid === currentUid;
                        return (
                            <div
                                key={rec.id}
                                onClick={() => isOwn && handleEdit(rec)}
                                onKeyDown={(e) => {
                                    if ((e.key === 'Enter' || e.key === ' ') && isOwn) {
                                        e.preventDefault();
                                        handleEdit(rec);
                                    }
                                }}
                                role={isOwn ? "button" : undefined}
                                tabIndex={isOwn ? 0 : undefined}
                                className={`glass-card p-3.5 flex items-center gap-3 transition-all
                                    ${isOwn ? 'cursor-pointer hover:ring-2 hover:ring-primary/30 active:scale-[0.99]' : ''}
                                    ${editingId === rec.id ? 'ring-2 ring-primary' : ''}`}
                            >
                                {/* 차량 아이콘 */}
                                <div className={`w-9 h-9 rounded-xl ${getVehicleColor(rec.vehicleId)} flex items-center justify-center text-lg flex-shrink-0`}>
                                    {vehicleIcon}
                                </div>

                                {/* 정보 */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-sm text-surface-900 dark:text-surface-100">{rec.vehicleName}</span>
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">
                                            {typeInfo.icon} {typeInfo.label}
                                        </span>
                                    </div>
                                    <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5 truncate">
                                        {rec.date}
                                        {rec.createdByName && ` · ${rec.createdByName}`}
                                        {rec.shop && ` · ${rec.shop}`}
                                        {rec.description && ` · ${rec.description}`}
                                    </p>
                                </div>

                                {/* 비용 + 삭제 */}
                                <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                                    {typeof rec.cost === 'number' && rec.cost > 0 && (
                                        <span className="text-sm font-bold text-surface-700 dark:text-surface-300">
                                            {rec.cost.toLocaleString()}원
                                        </span>
                                    )}
                                    {typeof rec.km === 'number' && rec.km > 0 && (
                                        <span className="text-xs text-surface-500 dark:text-surface-400">
                                            {rec.km.toLocaleString()} km
                                        </span>
                                    )}
                                    {isOwn && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDelete(rec); }}
                                            className="text-[10px] text-surface-300 dark:text-surface-600 hover:text-red-500 dark:hover:text-red-400 transition-colors mt-0.5 min-w-[48px] min-h-[48px] flex items-center justify-center"
                                            aria-label="기록 삭제"
                                        >
                                            삭제
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
