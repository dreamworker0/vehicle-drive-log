/**
 * ReservationTypeSelector — 다일 예약 / 반복 예약 체크박스 + 다일 예약 날짜 선택
 */
import { memo } from 'react';
import type { ReservationForm } from '../../../types/reservation';

interface Props {
    form: ReservationForm;
    setForm: React.Dispatch<React.SetStateAction<ReservationForm>>;
    selectedDate: string;
    /** 반복 그룹을 수정 중이면 예약 유형은 바꿀 수 없다 (아래 주석 참고) */
    editingRecurringGroupId?: string | null;
}

export default memo(function ReservationTypeSelector({ form, setForm, selectedDate, editingRecurringGroupId }: Props) {
    // 반복 그룹 수정 중에는 유형 전환을 막는다.
    // 수정은 "그룹을 지우고 다시 만든다"로 구현돼 있어 반복을 끄면 다시 만들 대상이 사라진다
    // (예전에는 이 상태로 제출하면 recurringDays가 undefined인 채 단건 저장을 시도해
    //  "Unsupported field value: undefined" 오류가 났다). 단건으로 바꾸려면 그룹을 취소하고
    // 새로 예약하는 것이 맞다.
    const typeLocked = !!editingRecurringGroupId;
    const lockedTitle = typeLocked ? '반복 예약 수정 중에는 예약 유형을 바꿀 수 없습니다. 단건으로 바꾸려면 반복 예약을 취소하고 새로 예약해주세요.' : undefined;

    return (
        <>
            {/* 다일 예약 / 반복 예약 체크박스 */}
            <div className="flex justify-end gap-3 pt-1">
                <label
                    title={lockedTitle}
                    className={`flex items-center gap-2 select-none px-2 py-1.5 rounded-lg transition-colors ${typeLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-800'}`}
                >
                    <input
                        type="checkbox"
                        disabled={typeLocked}
                        checked={!!(form.endDate && form.endDate > selectedDate)}
                        onChange={e => {
                            if (e.target.checked) {
                                const next = new Date(selectedDate + 'T00:00');
                                next.setDate(next.getDate() + 1);
                                const y = next.getFullYear();
                                const m = String(next.getMonth() + 1).padStart(2, '0');
                                const d = String(next.getDate()).padStart(2, '0');
                                setForm(prev => ({ ...prev, endDate: `${y}-${m}-${d}`, isRecurring: false }));
                            } else {
                                setForm(prev => ({ ...prev, endDate: '' }));
                            }
                        }}
                        className="w-4 h-4 rounded border-surface-300 dark:border-surface-600 text-primary-600 dark:text-primary-400 focus:ring-primary-500"
                    />
                    <span className="text-sm font-medium text-surface-600 dark:text-surface-300">
                        다일 예약
                        {form.endDate && form.endDate > selectedDate && !form.isRecurring && (() => {
                            const start = new Date(selectedDate + 'T00:00');
                            const end = new Date(form.endDate + 'T00:00');
                            const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                            return <span className="text-blue-600 dark:text-blue-400 font-bold ml-1">· {diffDays}일간</span>;
                        })()}
                    </span>
                </label>
                <label
                    title={lockedTitle}
                    className={`flex items-center gap-2 select-none px-2 py-1.5 rounded-lg transition-colors ${typeLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-800'}`}
                >
                    <input
                        type="checkbox"
                        disabled={typeLocked}
                        checked={!!form.isRecurring}
                        onChange={e => {
                            if (e.target.checked) {
                                const endD = new Date(selectedDate + 'T00:00');
                                endD.setDate(endD.getDate() + 28);
                                const y = endD.getFullYear();
                                const m = String(endD.getMonth() + 1).padStart(2, '0');
                                const d = String(endD.getDate()).padStart(2, '0');
                                setForm(prev => ({
                                    ...prev,
                                    isRecurring: true,
                                    recurringDays: [],
                                    recurringEndDate: `${y}-${m}-${d}`,
                                    excludeHolidays: true,
                                    excludedDates: [],
                                    endDate: '',
                                }));
                            } else {
                                setForm(prev => ({
                                    ...prev,
                                    isRecurring: false,
                                    recurringDays: undefined,
                                    recurringEndDate: undefined,
                                    excludeHolidays: undefined,
                                    excludedDates: undefined,
                                }));
                            }
                        }}
                        className="w-4 h-4 rounded border-surface-300 dark:border-surface-600 text-purple-600 dark:text-purple-400 focus:ring-purple-500"
                    />
                    <span className="text-sm font-medium text-surface-600 dark:text-surface-300">
                        반복 예약
                    </span>
                </label>
            </div>

            {/* 다일 예약: 시작일 / 종료일 */}
            {form.endDate && form.endDate > selectedDate && !form.isRecurring && (
                <div className="grid grid-cols-2 gap-2 animate-fade-in">
                    <div>
                        <label className="label text-xs text-surface-400 dark:text-surface-500">시작일</label>
                        <p className="text-sm text-surface-600 dark:text-surface-300 px-2 py-1.5 bg-surface-100 dark:bg-surface-700/50 rounded-lg h-[38px] flex items-center">
                            {selectedDate}
                            <span className="text-surface-400 dark:text-surface-500 ml-1 text-xs">
                                ({['일','월','화','수','목','금','토'][new Date(selectedDate + 'T00:00').getDay()]})
                            </span>
                        </p>
                    </div>
                    <div>
                        <label className="label text-xs">종료일</label>
                        <input
                            type="date"
                            value={form.endDate}
                            min={selectedDate}
                            onChange={e => setForm(prev => ({ ...prev, endDate: e.target.value }))}
                            className="input text-sm px-2 h-[38px]"
                        />
                    </div>
                </div>
            )}
        </>
    );
});
