/**
 * HolidayManager — 공휴일 관리 서브 컴포넌트
 * Settings에서 추출, 월별 그리드 디자인
 */
import React, { useState } from 'react';

interface HolidayForm {
    date: string;
    name: string;
}

interface PublicHoliday {
    date: string;
    name: string;
}

interface CustomHoliday {
    id: string;
    date: string | { toDate?: () => Date };
    name: string;
}

interface HolidayItem {
    id?: string;
    date: string | { toDate?: () => Date };
    name: string;
    type: 'public' | 'custom';
}

interface Props {
    holidayYear: number;
    setHolidayYear: React.Dispatch<React.SetStateAction<number>>;
    holidayForm: HolidayForm;
    setHolidayForm: React.Dispatch<React.SetStateAction<HolidayForm>>;
    addingHoliday: boolean;
    publicHolidays: Record<string, PublicHoliday[]>;
    filteredCustomHolidays: CustomHoliday[];
    onAddHoliday: (e: React.FormEvent) => void;
    onDeleteHoliday: (id: string) => void;
}

export default function HolidayManager({
    holidayYear,
    setHolidayYear,
    holidayForm,
    setHolidayForm,
    addingHoliday,
    publicHolidays,
    filteredCustomHolidays,
    onAddHoliday,
    onDeleteHoliday,
}: Props) {
    const [showAddForm, setShowAddForm] = useState(false);

    // 월별로 공휴일 + 커스텀 휴일을 합쳐서 정리
    const monthlyHolidays: Record<number, HolidayItem[]> = {};
    for (let m = 1; m <= 12; m++) {
        monthlyHolidays[m] = [];
    }
    // 법정 공휴일 추가
    Object.entries(publicHolidays).forEach(([month, holidays]) => {
        const m = parseInt(month, 10);
        if (monthlyHolidays[m]) {
            holidays.forEach(h => {
                monthlyHolidays[m].push({ ...h, type: 'public' });
            });
        }
    });
    // 커스텀 휴일 추가
    filteredCustomHolidays.forEach(h => {
        const date = typeof h.date === 'string' ? h.date : h.date?.toDate?.()?.toISOString?.()?.slice(0, 10) || '';
        const m = parseInt(date.split('-')[1], 10);
        if (monthlyHolidays[m]) {
            monthlyHolidays[m].push({ ...h, type: 'custom' });
        }
    });

    return (
        <div className="glass-card p-6 mb-6">
            {/* 헤더 — 3분할: 제목 | 연도 네비 | 버튼 */}
            <div className="grid grid-cols-3 items-center mb-5">
                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">공휴일 관리</h2>
                <div className="flex items-center justify-center gap-2">
                    <button
                        onClick={() => setHolidayYear(y => y - 1)}
                        className="btn-icon btn-ghost text-sm"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <span className="text-sm font-semibold text-surface-700 dark:text-surface-300 min-w-[4rem] text-center">{holidayYear}년</span>
                    <button
                        onClick={() => setHolidayYear(y => y + 1)}
                        className="btn-icon btn-ghost text-sm"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                    </button>
                </div>
                <div className="flex justify-end">
                    <button
                        onClick={() => setShowAddForm(v => !v)}
                        className="btn-sm btn-primary flex-shrink-0"
                    >
                        {showAddForm ? '닫기' : '+ 커스텀 추가'}
                    </button>
                </div>
            </div>

            {/* 커스텀 휴일 추가 폼 (토글) */}
            {showAddForm && (
                <form onSubmit={(e) => { onAddHoliday(e); setShowAddForm(false); }} className="flex gap-2 mb-5 p-3 rounded-xl bg-surface-50 dark:bg-surface-800 border border-surface-100 dark:border-surface-700">
                    <input
                        type="date"
                        value={holidayForm.date}
                        onChange={e => setHolidayForm({ ...holidayForm, date: e.target.value })}
                        className="input text-sm flex-shrink-0"
                        style={{ width: '160px' }}
                        required
                    />
                    <input
                        type="text"
                        value={holidayForm.name}
                        onChange={e => setHolidayForm({ ...holidayForm, name: e.target.value })}
                        className="input text-sm flex-1"
                        placeholder="휴일명 (예: 창립기념일)"
                        required
                    />
                    <button type="submit" disabled={addingHoliday} className="btn-sm btn-primary flex-shrink-0">
                        {addingHoliday ? (<div className="w-4 h-4 spinner" />) : '추가'}
                    </button>
                </form>
            )}

            {/* 월별 그리드 */}
            <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
                    const holidays = monthlyHolidays[month] || [];
                    return (
                        <div
                            key={month}
                            className="rounded-xl border border-surface-100 dark:border-surface-700 p-3 min-h-[100px]"
                        >
                            <p className="text-sm font-bold text-surface-900 dark:text-surface-100 mb-2">{month}월</p>
                            {holidays.length === 0 ? (
                                <p className="text-xs text-surface-300 dark:text-surface-600">공휴일 없음</p>
                            ) : (
                                <div className="space-y-1">
                                    {holidays.map((h, idx) => {
                                        const day = typeof h.date === 'string'
                                            ? parseInt(h.date.split('-')[2], 10)
                                            : h.date?.toDate?.()?.getDate?.() || '?';
                                        return (
                                            <div key={idx} className="flex items-start gap-1.5 group">
                                                <span className="text-xs text-surface-400 dark:text-surface-500 font-mono w-5 text-right flex-shrink-0">{day}</span>
                                                <span className={`text-xs leading-tight ${h.type === 'custom' ? 'text-primary-500 dark:text-primary-400' : 'text-red-500 dark:text-red-400'}`}>
                                                    {h.name}
                                                </span>
                                                {h.type === 'custom' && (
                                                    <button
                                                        onClick={() => onDeleteHoliday(h.id!)}
                                                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all ml-auto flex-shrink-0"
                                                        title="삭제"
                                                    >
                                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
