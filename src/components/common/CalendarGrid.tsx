/**
 * CalendarGrid — 월별 달력 그리드
 * ReservationCalendar에서 추출된 서브 컴포넌트
 */
import type { CalendarDay, Reservation } from '../../types/reservation';

interface Props {
    calendarDays: (CalendarDay | null)[];
    selectedDate: string;
    todayStr: string;
    monthLabel: string;
    onDateSelect: (dateStr: string) => void;
    onPrevMonth: () => void;
    onNextMonth: () => void;
}

export default function CalendarGrid({
    calendarDays,
    selectedDate,
    todayStr,
    monthLabel,
    onDateSelect,
    onPrevMonth,
    onNextMonth,
}: Props) {
    return (
        <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-4">
                <button onClick={onPrevMonth} className="btn-icon btn-ghost" aria-label="이전 달">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                </button>
                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">{monthLabel}</h2>
                <button onClick={onNextMonth} className="btn-icon btn-ghost" aria-label="다음 달">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                </button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-2">
                {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
                    <div key={d} className={`text-center text-xs font-medium py-1 ${i === 0 || i === 6 ? 'text-red-500' : 'text-surface-400'}`}>{d}</div>
                ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day, i) => {
                    if (!day) return <div key={`empty-${i}`} />;
                    const isToday = day.dateStr === todayStr;
                    const isSelected = day.dateStr === selectedDate;
                    const hasRes = day.reservations.length > 0;
                    const isWeekend = i % 7 === 0 || i % 7 === 6;
                    const isHoliday = !!day.holiday;
                    const isRedDay = isWeekend || isHoliday;

                    return (
                        <button
                            key={day.dateStr}
                            onClick={() => onDateSelect(day.dateStr)}
                            className={`relative p-2 rounded-xl text-sm transition-all
                      ${isSelected ? 'bg-primary-600 text-white shadow-md' :
                                    isToday && isRedDay ? 'bg-primary-50 dark:bg-primary-900/30 text-red-600 dark:text-red-400 font-bold ring-2 ring-primary-300 dark:ring-primary-700' :
                                        isToday ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-bold' :
                                            isRedDay ? 'hover:bg-surface-100 dark:hover:bg-surface-700 text-red-500 dark:text-red-400' :
                                                'hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-700 dark:text-surface-300'}
                    `}
                            title={day.holiday || ''}
                            aria-label={`${day.dateStr.replace(/-/g, '년 ').replace(/ (\d{2})$/, '월 $1일')}${day.holiday ? ` ${day.holiday}` : ''}${hasRes ? `, 예약 ${day.reservations.length}건` : ''}`}
                            aria-pressed={isSelected}
                        >
                            {day.date}
                            {hasRes && (
                                <div className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5`}>
                                    {day.reservations.slice(0, 3).map((r, idx) => {
                                        const isGroup = !!r.groupId;
                                        const isRecurring = !!r.recurringGroupId;
                                        return (
                                            <div key={idx} className={`w-1 h-1 rounded-full ${
                                                isSelected ? 'bg-white dark:bg-surface-800' :
                                                isRecurring ? 'bg-purple-500' :
                                                isGroup ? 'bg-blue-500' : 'bg-primary-500'
                                            }`} />
                                        );
                                    })}
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
