/**
 * MaintenanceLog — 차량 정비 기록 페이지
 * 로직은 useMaintenanceLog 훅 사용
 */
import useMaintenanceLog, { MAINTENANCE_TYPES } from '../../hooks/useMaintenanceLog';
import { VEHICLE_TYPE_ICONS } from '../../lib/constants';
import { SkeletonBox, SkeletonList } from '../common/Skeleton';

export default function MaintenanceLog() {
    const {
        vehicles, loading, showForm, setShowForm,
        saving, filterVehicle, setFilterVehicle,
        form, setForm, filteredRecords,
        handleSubmit, handleDelete, getTypeInfo, handleVehicleSelect,
        handleClearBlock,
    } = useMaintenanceLog();

    const blockedVehicles = vehicles.filter(v => v.maintenance?.isBlocked);

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
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">차량 정비 기록</h1>
                <button onClick={() => setShowForm(!showForm)} className="btn-primary btn-sm flex items-center gap-1">
                    {showForm ? '✕ 닫기' : '＋ 정비 기록 추가'}
                </button>
            </div>

            {/* 등록 폼 */}
            {showForm && (
                <form onSubmit={handleSubmit} className="glass-card p-5 mb-6 space-y-4 animate-fade-in">
                    <h2 className="font-semibold text-surface-800 dark:text-surface-200">새 정비 기록</h2>
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
                                <p className="text-xs text-surface-400 mt-1">종료 예정일은 참고용이며, 관리자가 수동으로 해제해야 합니다</p>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end">
                        <button type="submit" disabled={saving} className="btn-primary">
                            {saving ? '저장 중...' : form.blockVehicle ? '🚫 정비 기록 저장 + 차량 차단' : '정비 기록 저장'}
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

            {/* 차량 필터 */}
            <div className="flex flex-wrap gap-1.5 mb-4">
                <button onClick={() => setFilterVehicle('')}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${!filterVehicle
                        ? 'bg-primary-100 border-primary-300 text-primary-700'
                        : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-primary-300'}`}>
                    전체
                </button>
                {vehicles.map(v => (
                    <button key={v.id} onClick={() => setFilterVehicle(v.id)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${filterVehicle === v.id
                            ? 'bg-primary-100 border-primary-300 text-primary-700'
                            : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-primary-300'}`}>
                        {VEHICLE_TYPE_ICONS[v.vehicleType ?? ''] || '🚗'} {v.displayName}
                    </button>
                ))}
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
                                    <button onClick={() => handleDelete(rec)} className="text-xs text-surface-300 hover:text-red-500 transition-colors">삭제</button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
