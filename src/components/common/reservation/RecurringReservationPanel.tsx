/**
 * RecurringReservationPanel - 반복 예약 설정 패널
 */
import React from 'react';
import { generateRecurringDates, DAY_NAMES } from '../../../hooks/utils/recurringUtils';
import type { Reservation, ReservationForm } from '../../../types/reservation';

interface RecurringReservationPanelProps {
    form: ReservationForm;
    setForm: React.Dispatch<React.SetStateAction<ReservationForm>>;
    selectedDate: string;
    holidays: { date: string; name: string }[];
    allReservations: Reservation[];
    editingRecurringGroupId?: string | null;
}

export default function RecurringReservationPanel({
    form,
    setForm,
    selectedDate,
    holidays,
    allReservations,
    editingRecurringGroupId,
}: RecurringReservationPanelProps) {
    const recurringStartDate = form.recurringStartDate || selectedDate;
    const recurringDates = generateRecurringDates({
        startDate: recurringStartDate,
        endDate: form.recurringEndDate || recurringStartDate,
        selectedDays: form.recurringDays || [],
        holidays,
        excludeHolidays: form.excludeHolidays ?? true,
        excludedDates: form.excludedDates,
    });

    // 충돌 검사
    const conflictMap = new Map<string, Reservation>();
    for (const dateStr of recurringDates) {
        const conflict = allReservations.find(r =>
            r.date === dateStr &&
            r.vehicleId === form.vehicleId &&
            r.status !== 'cancelled' &&
            r.id !== editingRecurringGroupId &&
            r.startTime < form.endTime &&
            r.endTime > form.startTime
        );
        if (conflict) conflictMap.set(dateStr, conflict);
    }

    return (
        <div className="space-y-3 p-3 rounded-xl bg-purple-50/50 border border-purple-100 dark:bg-purple-900/10 dark:border-purple-800/30 animate-fade-in">
            {/* 요일 선택 */}
            <div>
                <label className="label text-xs text-purple-700 dark:text-purple-300 mb-1.5">반복 요일</label>
                <div className="flex gap-1.5">
                    {DAY_NAMES.map((name, idx) => {
                        const isSelected = (form.recurringDays || []).includes(idx);
                        const isWeekend = idx === 0 || idx === 6;
                        return (
                            <button
                                key={idx}
                                type="button"
                                onClick={() => {
                                    const days = [...(form.recurringDays || [])];
                                    if (isSelected) {
                                        setForm({ ...form, recurringDays: days.filter(d => d !== idx) });
                                    } else {
                                        setForm({ ...form, recurringDays: [...days, idx].sort() });
                                    }
                                }}
                                className={`w-9 h-9 rounded-lg text-xs font-bold transition-all ${
                                    isSelected
                                        ? 'bg-purple-500 text-white shadow-md ring-1 ring-purple-400'
                                        : isWeekend
                                            ? 'bg-surface-100 dark:bg-surface-800 text-red-400 dark:text-red-500 border border-surface-200 dark:border-surface-700 hover:border-purple-300'
                                            : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 border border-surface-200 dark:border-surface-700 hover:border-purple-300'
                                }`}
                            >
                                {name}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 기간 설정 */}
            <div className="grid grid-cols-2 gap-2">
                <div>
                    <label className="label text-xs text-surface-400 dark:text-surface-500">시작일</label>
                    <input
                        type="date"
                        value={form.recurringStartDate || selectedDate}
                        onChange={e => setForm({ ...form, recurringStartDate: e.target.value })}
                        className="input text-sm px-2 h-[38px]"
                    />
                </div>
                <div>
                    <label className="label text-xs">종료일</label>
                    <input
                        type="date"
                        value={form.recurringEndDate || ''}
                        min={form.recurringStartDate || selectedDate}
                        onChange={e => setForm({ ...form, recurringEndDate: e.target.value })}
                        className="input text-sm px-2 h-[38px]"
                    />
                </div>
            </div>

            {/* 공휴일 제외 */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                    type="checkbox"
                    checked={form.excludeHolidays ?? true}
                    onChange={e => setForm({ ...form, excludeHolidays: e.target.checked })}
                    className="w-3.5 h-3.5 rounded border-surface-300 dark:border-surface-600 text-purple-600 dark:text-purple-400 focus:ring-purple-500"
                />
                <span className="text-xs text-surface-500 dark:text-surface-400">공휴일 자동 제외</span>
            </label>

            {/* 날짜 미리보기 */}
            {(form.recurringDays || []).length > 0 && recurringDates.length > 0 && (
                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-purple-700 dark:text-purple-300">
                            📅 예약될 날짜
                            <span className="ml-1 font-bold">({recurringDates.length}일)</span>
                            {conflictMap.size > 0 && (
                                <span className="ml-1 text-amber-600 dark:text-amber-400">⚠️ 충돌 {conflictMap.size}건</span>
                            )}
                        </span>
                    </div>
                    <div className="flex flex-wrap gap-1 max-h-[120px] overflow-y-auto">
                        {recurringDates.map(dateStr => {
                            const d = new Date(dateStr + 'T00:00');
                            const dayName = DAY_NAMES[d.getDay()];
                            const conflict = conflictMap.get(dateStr);
                            const isExcluded = (form.excludedDates || []).includes(dateStr);
                            return (
                                <button
                                    key={dateStr}
                                    type="button"
                                    onClick={() => {
                                        const excluded = [...(form.excludedDates || [])];
                                        if (isExcluded) {
                                            setForm({ ...form, excludedDates: excluded.filter(d => d !== dateStr) });
                                        } else {
                                            setForm({ ...form, excludedDates: [...excluded, dateStr] });
                                        }
                                    }}
                                    title={conflict ? `충돌: ${conflict.vehicleName || '차량'} ${conflict.startTime}~${conflict.endTime}` : isExcluded ? '클릭하여 복원' : '클릭하여 제외'}
                                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-all ${
                                        isExcluded
                                            ? 'bg-surface-100 dark:bg-surface-800 text-surface-400 border-surface-200 dark:border-surface-700 line-through opacity-60'
                                            : conflict
                                                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700'
                                                : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700'
                                    }`}
                                >
                                    {`${parseInt(dateStr.slice(5, 7))}/${parseInt(dateStr.slice(8))}(${dayName})`}
                                    {conflict && ' ⚠️'}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {(form.recurringDays || []).length === 0 && (
                <p className="text-xs text-surface-400 dark:text-surface-500 text-center py-2">반복할 요일을 선택하세요</p>
            )}
        </div>
    );
}
