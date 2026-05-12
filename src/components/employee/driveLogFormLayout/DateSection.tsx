import { useMemo, memo } from 'react';
import { todayStr } from '../../../hooks/utils/driveLogValidation';
import type { DriveLogForm } from '../../../hooks/driveLogForm/types';

/** 2달 전 날짜를 YYYY-MM-DD로 반환 */
function getMinDateStr(): string {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface DateSectionProps {
    form: DriveLogForm;
    setForm: (f: DriveLogForm) => void;
    isRetroactive: boolean;
}

const DateSection = memo(function DateSection({ form, setForm, isRetroactive }: DateSectionProps) {
    const today = todayStr();
    const minDate = useMemo(() => getMinDateStr(), []);

    return (
        <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">📅 운행 일자 및 시각</h3>
            <div className="mb-4">
                <label htmlFor="driveDate" className="label text-xs">운행 일자</label>
                <input
                    id="driveDate"
                    type="date"
                    value={form.driveDate}
                    min={minDate}
                    max={today}
                    onChange={e => setForm({ ...form, driveDate: e.target.value })}
                    className="input"
                />
                <p className="text-[11px] text-surface-400 mt-1">2달 이내의 날짜만 선택할 수 있습니다.</p>
                {isRetroactive && (
                    <p className="text-[11px] text-amber-500 dark:text-amber-400 mt-0.5">
                        ⚠️ 소급 입력: 오늘이 아닌 날짜로 기록됩니다.
                    </p>
                )}
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label htmlFor="startTime" className="label text-xs">출발 시각</label>
                    <input
                        id="startTime"
                        type="time"
                        value={form.startTime}
                        onChange={e => setForm({ ...form, startTime: e.target.value })}
                        className="input"
                    />
                </div>
                <div>
                    <label htmlFor="endTime" className="label text-xs">도착 시각</label>
                    <input
                        id="endTime"
                        type="time"
                        value={form.endTime}
                        onChange={e => setForm({ ...form, endTime: e.target.value })}
                        className="input"
                    />
                </div>
            </div>
        </div>
    );
});

export default DateSection;
