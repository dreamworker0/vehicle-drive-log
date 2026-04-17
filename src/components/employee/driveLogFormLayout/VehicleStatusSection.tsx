import { memo } from 'react';
import type { DriveLogForm } from '../../../hooks/driveLogForm/types';
import type { HipassCard } from '../../../types/hipass';

interface VehicleStatusSectionProps {
    isElectric: boolean;
    form: DriveLogForm;
    setForm: (f: DriveLogForm) => void;
    lastEndBattery: number | null;
    hipassCard: HipassCard | null;
}

const VehicleStatusSection = memo(function VehicleStatusSection({
    isElectric,
    form,
    setForm,
    lastEndBattery,
    hipassCard
}: VehicleStatusSectionProps) {
    if (!isElectric && !hipassCard) return null;

    return (
        <div className="space-y-5">
            {/* 배터리 (전기차만) */}
            {isElectric && (
                <div className="glass-card p-4">
                    <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">🔋 배터리</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="batteryStart" className="label text-xs">출발 배터리 %</label>
                            <input
                                id="batteryStart"
                                type="number"
                                min="0" max="100"
                                value={form.batteryStart}
                                onChange={e => setForm({ ...form, batteryStart: e.target.value })}
                                className="input"
                                placeholder={lastEndBattery != null ? `이전 도착: ${lastEndBattery}%` : '80'}
                            />
                        </div>
                        <div>
                            <label htmlFor="batteryEnd" className="label text-xs">도착 배터리 %</label>
                            <input
                                id="batteryEnd"
                                type="number"
                                min="0" max="100"
                                value={form.batteryEnd}
                                onChange={e => setForm({ ...form, batteryEnd: e.target.value })}
                                className="input"
                                placeholder="45"
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* 하이패스 (등록된 차량만) */}
            {hipassCard && (
                <div className="glass-card p-4">
                    <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">💳 하이패스</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="label text-xs">사용전 금액</label>
                            <div className="input bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400 cursor-not-allowed" aria-label="하이패스 사용전 금액">
                                {hipassCard.balance.toLocaleString()}원
                            </div>
                        </div>
                        <div>
                            <label htmlFor="hipassAfter" className="label text-xs">사용후 금액</label>
                            <input
                                id="hipassAfter"
                                type="number"
                                value={form.hipassBalanceAfter}
                                onChange={e => setForm({ ...form, hipassBalanceAfter: e.target.value })}
                                className="input"
                                placeholder={hipassCard.balance.toLocaleString()}
                                min="0"
                            />
                        </div>
                    </div>
                    {form.hipassBalanceAfter !== '' && (
                        <div className="mt-3 flex items-center justify-between px-1">
                            <span className="text-xs text-surface-400">
                                사용 금액: <span className="font-bold text-red-500">-{(hipassCard.balance - Number(form.hipassBalanceAfter)).toLocaleString()}원</span>
                            </span>
                            <span className={`text-sm font-bold ${
                                Number(form.hipassBalanceAfter) <= 5000
                                    ? 'text-red-500'
                                    : Number(form.hipassBalanceAfter) <= 20000
                                        ? 'text-amber-500'
                                        : 'text-accent-600 dark:text-accent-400'
                            }`}>
                                잔액: {Number(form.hipassBalanceAfter).toLocaleString()}원
                            </span>
                        </div>
                    )}
                    <p className="text-xs text-surface-400 mt-2">하이패스 사용 시 사용후 금액을 입력하면 잔액이 자동으로 업데이트됩니다</p>
                </div>
            )}
        </div>
    );
});

export default VehicleStatusSection;
