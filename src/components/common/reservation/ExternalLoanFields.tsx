/**
 * ExternalLoanFields — 외부 대여(앱을 쓰지 않는 기관에 차량을 빌려주기) 입력. 관리자 전용.
 *
 * 켜면 이 예약은 **명의자 없이** 빌려 가는 기관·운전자 이름으로 저장된다(서버 createReservationCore).
 * 그 기간에는 기관의 누구도 이 차를 예약·운행할 수 없고, 목적지는 선택이 된다.
 * 며칠 빌려주면 아래 '다일 예약'으로 종료일을 정한다 — 날짜별 예약이 한 그룹으로 묶인다.
 *
 * 수정 중에는 끌 수 없다. 대여를 일반 예약으로 바꾸면 명의자를 새로 정해야 해서, 취소 후 다시 예약한다.
 */
import { memo } from 'react';
import Toggle from '../Toggle';
import type { ReservationForm } from '../../../types/reservation';

/** 서버(createReservationCore의 EXTERNAL_LOAN_TEXT_MAX)와 같은 상한 */
export const EXTERNAL_LOAN_TEXT_MAX = 50;

interface Props {
    form: ReservationForm;
    setForm: React.Dispatch<React.SetStateAction<ReservationForm>>;
    /** 이미 저장된 대여를 수정 중인가 — 이때는 대여를 끌 수 없다 */
    locked?: boolean;
}

export default memo(function ExternalLoanFields({ form, setForm, locked = false }: Props) {
    const loan = form.externalLoan;
    const enabled = Boolean(loan);

    const toggle = (next: boolean) => {
        setForm(prev => next
            // 반복 예약과 함께 쓸 수 없다 — 대여는 정해진 한 기간이다
            ? {
                ...prev,
                externalLoan: { borrowerOrg: '', driverName: '' },
                isRecurring: false,
                recurringDays: undefined,
                recurringEndDate: undefined,
                excludeHolidays: undefined,
                excludedDates: undefined,
            }
            : { ...prev, externalLoan: undefined });
    };

    const update = (key: 'borrowerOrg' | 'driverName', value: string) => {
        setForm(prev => ({
            ...prev,
            externalLoan: { borrowerOrg: '', driverName: '', ...prev.externalLoan, [key]: value },
        }));
    };

    return (
        <div className={`rounded-xl border p-3 ${enabled
            ? 'border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-900/20'
            : 'border-surface-200 dark:border-surface-700'}`}
        >
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-medium text-surface-700 dark:text-surface-200">🤝 외부 대여</p>
                    <p className="text-xs text-surface-500 dark:text-surface-400">
                        이 앱을 쓰지 않는 기관에 차를 빌려줄 때 켜세요. 그 기간에는 직원이 예약할 수 없어요.
                    </p>
                </div>
                <Toggle label="외부 대여" checked={enabled} onChange={toggle} disabled={locked} onClassName="bg-amber-500" />
            </div>

            {enabled && (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 animate-fade-in">
                    <div>
                        <label htmlFor="external-loan-org" className="label text-xs">빌려 가는 기관 *</label>
                        <input
                            id="external-loan-org"
                            type="text"
                            value={loan?.borrowerOrg ?? ''}
                            maxLength={EXTERNAL_LOAN_TEXT_MAX}
                            onChange={e => update('borrowerOrg', e.target.value)}
                            className="input w-full text-sm min-h-[48px]"
                            placeholder="예: ○○복지관"
                        />
                    </div>
                    <div>
                        <label htmlFor="external-loan-driver" className="label text-xs">운전자(담당자) *</label>
                        <input
                            id="external-loan-driver"
                            type="text"
                            value={loan?.driverName ?? ''}
                            maxLength={EXTERNAL_LOAN_TEXT_MAX}
                            onChange={e => update('driverName', e.target.value)}
                            className="input w-full text-sm min-h-[48px]"
                            placeholder="예: 홍길동"
                        />
                    </div>
                    <p className="sm:col-span-2 text-xs text-surface-500 dark:text-surface-400">
                        연락처는 저장하지 않아요. 며칠 빌려주면 아래 <strong>다일 예약</strong>으로 반납일을 정하세요.
                    </p>
                </div>
            )}
        </div>
    );
});
