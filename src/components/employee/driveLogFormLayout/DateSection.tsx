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

    // 이틀 이상 걸린 운행인가. 비어 있으면 같은 날로 본다(기존 문서 전부가 그 경우다).
    const endDate = form.endDate || form.driveDate;
    const isMultiDay = !!form.driveDate && endDate > form.driveDate;
    const nightCount = isMultiDay
        ? Math.round((new Date(endDate + 'T00:00').getTime() - new Date(form.driveDate + 'T00:00').getTime()) / 86400000)
        : 0;

    return (
        <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">📅 운행 일자 및 시각</h3>
            <div className="mb-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="driveDate" className="label text-xs">출발일</label>
                        <input
                            id="driveDate"
                            type="date"
                            value={form.driveDate}
                            min={minDate}
                            max={today}
                            onChange={e => {
                                const next = e.target.value;
                                // 출발일을 뒤로 밀면 도착일이 그보다 앞설 수 있다 — 그때는 비운다.
                                const keepEnd = form.endDate && form.endDate >= next ? form.endDate : '';
                                setForm({ ...form, driveDate: next, endDate: keepEnd });
                            }}
                            className="input min-h-[48px]"
                        />
                    </div>
                    <div>
                        <label htmlFor="endDate" className="label text-xs">도착일</label>
                        <input
                            id="endDate"
                            type="date"
                            value={form.endDate || form.driveDate}
                            min={form.driveDate || minDate}
                            max={today}
                            onChange={e => setForm({ ...form, endDate: e.target.value })}
                            className="input min-h-[48px]"
                        />
                    </div>
                </div>
                <p className="text-[11px] text-surface-400 dark:text-surface-500 mt-1">2달 이내의 날짜만 선택할 수 있습니다.</p>
                {isMultiDay && (
                    <p className="text-[11px] text-blue-500 dark:text-blue-400 mt-0.5">
                        🌙 {nightCount}박 {nightCount + 1}일 운행으로 기록됩니다 — 계기판은 출발·도착 한 쌍만 적습니다.
                    </p>
                )}
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
                        className="input min-h-[48px]"
                    />
                </div>
                <div>
                    <label htmlFor="endTime" className="label text-xs">도착 시각</label>
                    <input
                        id="endTime"
                        type="time"
                        value={form.endTime}
                        onChange={e => setForm({ ...form, endTime: e.target.value })}
                        className="input min-h-[48px]"
                    />
                </div>
            </div>
        </div>
    );
});

export default DateSection;
