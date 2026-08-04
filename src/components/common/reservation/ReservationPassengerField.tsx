/**
 * ReservationPassengerField — 예약 폼의 동승자(예정) 입력
 *
 * 운행일지와 **같은** 입력 컴포넌트(PassengerSection)를 쓴다. 두 화면이 갈라지면
 * 기관이 정한 입력 방식(목록·검색·인원 숫자)이 한쪽에서만 지켜지는 일이 생긴다.
 *
 * 이 컴포넌트가 하는 일은 두 가지뿐이다.
 *  (1) 예약 폼 상태(ReservationForm)와 PassengerSection의 입출력을 잇는다.
 *  (2) 기본으로 접어 둔다 — 예약 폼은 이미 차량·목적지·목적·유형·시간으로 빽빽하고,
 *      동승자는 선택 입력이라 펼쳐 두면 매번 지나쳐야 하는 벽이 된다.
 */
import { memo, useMemo, useState } from 'react';
import PassengerSection from '../PassengerSection';
import { parseExternalNames } from '../../../hooks/utils/reservationPassengers';
import type { ReservationForm } from '../../../types/reservation';
import type { User as UserDoc } from '../../../types/user';

interface Props {
    form: ReservationForm;
    setForm: React.Dispatch<React.SetStateAction<ReservationForm>>;
    members: UserDoc[];
    allowList?: boolean;
    allowSearch?: boolean;
    allowCount?: boolean;
}

export default memo(function ReservationPassengerField({
    form, setForm, members, allowList = true, allowSearch = true, allowCount = true,
}: Props) {
    const selectedPassengers = useMemo(
        () => members.filter(m => (form.passengerUids || []).includes(m.id)),
        [members, form.passengerUids],
    );

    const externalCount = form.passengerCount || 0;
    const externalNamesRaw = form.passengerExternalNames || '';
    const totalCount = selectedPassengers.length + parseExternalNames(externalNamesRaw).length + externalCount;

    // 이미 입력된 값이 있으면(수정 진입 등) 펼친 채로 연다 — 접힌 채로 두면
    // "적어 둔 동승자가 사라진 것처럼" 보인다.
    const [isOpen, setIsOpen] = useState(totalCount > 0);

    const togglePassenger = (member: UserDoc) => {
        setForm(prev => {
            const current = prev.passengerUids || [];
            return {
                ...prev,
                passengerUids: current.includes(member.id)
                    ? current.filter(id => id !== member.id)
                    : [...current, member.id],
            };
        });
    };

    return (
        <div>
            <button
                type="button"
                onClick={() => setIsOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 min-h-[48px] rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            >
                <span className="label mb-0 text-sm font-medium">
                    🧑‍🤝‍🧑 동승자
                    <span className="ml-1 text-xs font-normal text-surface-400 dark:text-surface-500">(선택)</span>
                    {totalCount > 0 && (
                        <span className="ml-2 text-primary-600 dark:text-primary-400 font-bold">{totalCount}명</span>
                    )}
                </span>
                <span className="text-xs text-surface-400 dark:text-surface-500">{isOpen ? '접기 ▲' : '펼치기 ▼'}</span>
            </button>

            {isOpen && (
                <div className="mt-1 animate-fade-in">
                    <PassengerSection
                        allowList={allowList}
                        allowSearch={allowSearch}
                        allowCount={allowCount}
                        members={members}
                        selectedPassengers={selectedPassengers}
                        externalPassengerCount={externalCount}
                        externalPassengerNames={externalNamesRaw}
                        togglePassenger={togglePassenger}
                        setExternalPassengerCount={count => setForm(prev => ({ ...prev, passengerCount: count }))}
                        setExternalPassengerNames={names => setForm(prev => ({ ...prev, passengerExternalNames: names }))}
                    />
                    <p className="mt-1 px-1 text-[11px] text-surface-400 dark:text-surface-500">
                        예약 시점의 <strong>예정 인원</strong>입니다. 운행일지를 쓸 때 자동으로 채워지고, 실제 탑승은 그때 확정합니다.
                        {form.isRecurring && ' 반복 예약은 모든 회차에 같은 인원이 적용됩니다.'}
                    </p>
                </div>
            )}
        </div>
    );
});
