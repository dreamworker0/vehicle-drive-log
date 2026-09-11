/**
 * FuelLogEditForm — 관리자용 주유 기록 정정 폼
 *
 * 지출결의서와 대조하다 발견한 주유량·금액 오류를 관리자가 직접 고치는 자리다.
 * 새 기록을 만드는 폼이 아니라 **이미 있는 기록을 고치는 폼**이므로 수정 중일 때만 뜬다.
 * 주유원은 바꾸지 않는다(useFuelLogAdmin 주석 참고) — 그래서 읽기 전용으로만 보여 준다.
 */
import { memo, useEffect, useRef } from 'react';
import type { FuelLog } from '../../../types/fuelLog';
import type { Vehicle } from '../../../types/vehicle';
import type { FuelLogEditForm as FormData } from '../../../hooks/useFuelLogAdmin';
import { stripNegative } from '../../../hooks/utils/numberValidation';
import { limitFuelDecimals } from '../../../lib/fuelFormat';
import { isChargeableFuel } from '../../../lib/vehicleModelData';

interface Props {
    record: FuelLog;
    form: FormData;
    setForm: React.Dispatch<React.SetStateAction<FormData>>;
    vehicles: Vehicle[];
    saving: boolean;
    onSubmit: (e: React.FormEvent) => void;
    onVehicleSelect: (vehicleId: string) => void;
    onCancel: () => void;
}

export default memo(function FuelLogEditForm({
    record, form, setForm, vehicles, saving, onSubmit, onVehicleSelect, onCancel,
}: Props) {
    const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);
    const isChargeable = isChargeableFuel(selectedVehicle?.fuelType);

    // 수정 버튼은 목록 아래쪽에 있을 수 있는데 폼은 화면 맨 위에 열린다 —
    // 스크롤을 옮겨 주지 않으면 눌러도 아무 일이 없는 것처럼 보인다.
    const formRef = useRef<HTMLFormElement>(null);
    useEffect(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [record.id]);

    return (
        <form ref={formRef} onSubmit={onSubmit} className="glass-card p-5 mb-6 space-y-4 animate-fade-in border-l-4 border-primary-400">
            <div>
                <h2 className="font-semibold text-surface-800 dark:text-surface-200">주유 기록 수정</h2>
                <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
                    {record.driverName || '직원'}님이 {record.date}에 등록한 기록입니다.
                    주유원은 바뀌지 않으며, 수정하면 목록에 '관리자 수정' 표시가 남습니다.
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="label">차량 <span className="text-red-500 dark:text-red-400">*</span></label>
                    <select value={form.vehicleId} onChange={e => onVehicleSelect(e.target.value)} className="input min-h-[48px]" required>
                        <option value="">선택</option>
                        {vehicles.map(v => (<option key={v.id} value={v.id}>{v.displayName}</option>))}
                    </select>
                </div>
                <div>
                    <label className="label">날짜 <span className="text-red-500 dark:text-red-400">*</span></label>
                    <input
                        type="date"
                        value={form.date}
                        onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))}
                        className="input min-h-[48px]"
                        required
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                    <label className="label">주유미터 (km) <span className="text-red-500 dark:text-red-400">*</span></label>
                    <input
                        type="number"
                        min="0"
                        value={form.meterReading}
                        onChange={e => setForm(prev => ({ ...prev, meterReading: stripNegative(e.target.value) }))}
                        className="input min-h-[48px]"
                        placeholder="45000"
                        required
                    />
                </div>
                <div>
                    <label className="label">{isChargeable ? '충전량 (kWh/kg)' : '주유량 (L)'} <span className="text-red-500 dark:text-red-400">*</span></label>
                    <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={form.fuelAmount}
                        onChange={e => setForm(prev => ({ ...prev, fuelAmount: limitFuelDecimals(stripNegative(e.target.value)) }))}
                        className="input min-h-[48px]"
                        placeholder="40.5"
                        required
                    />
                </div>
                <div>
                    <label className="label">{isChargeable ? '충전금액 (원)' : '주유금액 (원)'} <span className="text-red-500 dark:text-red-400">*</span></label>
                    <input
                        type="number"
                        min="0"
                        value={form.fuelCost}
                        onChange={e => setForm(prev => ({ ...prev, fuelCost: stripNegative(e.target.value) }))}
                        className="input min-h-[48px]"
                        placeholder="65000"
                        required
                    />
                </div>
            </div>

            <div>
                <label className="label">비고</label>
                <textarea
                    value={form.notes}
                    onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                    className="input min-h-[60px] resize-none"
                    placeholder="정정 사유를 남겨 두면 나중에 대조하기 쉽습니다"
                    rows={2}
                />
            </div>

            <div className="flex justify-end gap-2">
                <button type="button" onClick={onCancel} className="btn-secondary min-h-[48px]">취소</button>
                <button type="submit" disabled={saving} className="btn-primary min-h-[48px]">
                    {saving ? '저장 중...' : '수정 완료'}
                </button>
            </div>
        </form>
    );
});
