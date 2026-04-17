/**
 * MaintenanceForm — 정비 등록/수정 폼
 */
import { memo } from 'react';
import { MAINTENANCE_TYPES } from '../../../hooks/useMaintenanceLog';
import type { Vehicle } from '../../../types/vehicle';

interface FormData {
    vehicleId: string;
    vehicleName: string;
    date: string;
    type: string;
    cost: string;
    shop: string;
    km: string;
    nextDueKm: string;
    nextDueDate: string;
    description: string;
    blockVehicle: boolean;
    blockEndDate: string;
}

interface Props {
    form: FormData;
    setForm: React.Dispatch<React.SetStateAction<FormData>>;
    vehicles: Vehicle[];
    editingId: string | null;
    saving: boolean;
    onSubmit: (e: React.FormEvent) => void;
    onVehicleSelect: (vehicleId: string) => void;
    onCancelEdit: () => void;
}

export default memo(function MaintenanceForm({
    form, setForm, vehicles, editingId, saving,
    onSubmit, onVehicleSelect, onCancelEdit,
}: Props) {
    return (
        <form onSubmit={onSubmit} className="glass-card p-5 mb-6 space-y-4 animate-fade-in">
            <h2 className="font-semibold text-surface-800 dark:text-surface-200">{editingId ? '정비 기록 수정' : '새 정비 기록'}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="label">차량 <span className="text-red-500">*</span></label>
                    <select value={form.vehicleId} onChange={e => onVehicleSelect(e.target.value)} className="input" required>
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
                    <button type="button" onClick={onCancelEdit} className="btn-secondary">취소</button>
                )}
                <button type="submit" disabled={saving} className="btn-primary">
                    {saving ? '저장 중...' : form.blockVehicle ? (editingId ? '🚫 기록 수정 + 차량 차단' : '🚫 정비 기록 저장 + 차량 차단') : (editingId ? '정비 기록 수정' : '정비 기록 저장')}
                </button>
            </div>
        </form>
    );
});
