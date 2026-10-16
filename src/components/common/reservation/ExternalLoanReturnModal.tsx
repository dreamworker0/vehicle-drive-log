/**
 * ExternalLoanReturnModal — 외부 대여 반납 처리. 관리자 전용.
 *
 * 빌려 간 기관은 운행일지를 쓸 수 없으므로, 차가 돌아오면 관리자가 계기판을 받아 대여 기간 전체를
 * 운행일지 한 건으로 남긴다(externalLoanReturn 머리 주석). 저장하면 대여 예약 묶음을 닫는다 —
 * 일찍 돌아왔으면 반납일 뒤의 날짜는 취소되어 그날부터 다시 예약할 수 있다(completeReservationGroupSiblings).
 */
import { useEffect, useMemo, useState } from 'react';
import { createDriveLog, updateReservationStatus, completeReservationGroupSiblings, getReservationsByGroupId } from '../../../lib/firestore';
import { resolveStartKm } from '../../../hooks/driveLogForm/resolveStartKm';
import { buildExternalLoanDriveLog, resolveLoanPeriod } from '../../../hooks/utils/externalLoanReturn';
import { invalidateDashboardCache } from '../../../hooks/useTodayDashboard';
import { useToast } from '../../../hooks/useToast';
import { useConfirm } from '../../../hooks/useConfirm';
import { captureError } from '../../../lib/sentry';
import type { Reservation } from '../../../types/reservation';
import type { Vehicle } from '../../../types/vehicle';

interface Props {
    reservation: Reservation;
    allReservations: Reservation[];
    vehicles: Vehicle[];
    orgId: string;
    adminUid: string;
    onClose: () => void;
    /** 저장을 마친 뒤 — 예약 목록을 다시 읽는다 */
    onDone: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export default function ExternalLoanReturnModal({ reservation, allReservations, vehicles, orgId, adminUid, onClose, onDone }: Props) {
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const vehicle = vehicles.find(v => v.id === reservation.vehicleId) ?? null;
    const loan = reservation.externalLoan;

    // 대여 묶음은 **서버에서 다시 읽는다.** 예약 화면은 그 달 예약만 들고 있어, 달을 넘긴 대여
    // (9/30 → 10/2)를 10월 화면에서 열면 첫날이 빠져 대여 시작을 10/1 00:00으로 잘못 잡는다 —
    // 운행일지의 출발일·출발 km가 함께 틀어진다. 읽기에 실패하면 화면에 있는 날짜로 대신한다.
    const [groupDays, setGroupDays] = useState<Reservation[] | null>(reservation.groupId ? null : allReservations);
    useEffect(() => {
        if (!reservation.groupId) return;
        let cancelled = false;
        getReservationsByGroupId(reservation.groupId, orgId)
            .then(days => { if (!cancelled) setGroupDays(days.length > 0 ? days as Reservation[] : allReservations); })
            .catch(() => { if (!cancelled) setGroupDays(allReservations); });
        return () => { cancelled = true; };
    }, [reservation.groupId, orgId, allReservations]);
    const period = useMemo(
        () => resolveLoanPeriod(reservation, groupDays ?? allReservations),
        [reservation, groupDays, allReservations],
    );
    const loadingGroup = groupDays === null;

    const [returnDate, setReturnDate] = useState('');
    const [returnTime, setReturnTime] = useState('');
    const [startKm, setStartKm] = useState('');
    const [endKm, setEndKm] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);

    // 묶음을 다 읽은 뒤 한 번 채운다
    //  · 반납 시각 — 예정 반납 시각이 이미 지났으면 그 시각, 아니면 지금(일찍 돌아온 경우)
    //  · 출발 km — 대여 시작 시점의 직전 도착 km(운행일지 작성 화면과 같은 규칙)
    useEffect(() => {
        if (loadingGroup) return;
        const now = new Date();
        const planned = `${period.plannedEndDate} ${period.plannedEndTime}`;
        const usePlanned = planned <= `${dateOf(now)} ${timeOf(now)}`;
        setReturnDate(prev => prev || (usePlanned ? period.plannedEndDate : dateOf(now)));
        setReturnTime(prev => prev || (usePlanned ? period.plannedEndTime : timeOf(now)));

        let cancelled = false;
        resolveStartKm(orgId, reservation.vehicleId, { driveDate: period.startDate, startTime: period.startTime, vehicle })
            .then(km => { if (!cancelled) setStartKm(prev => prev || km); })
            .catch(() => { /* 비워 두면 관리자가 직접 적는다 */ });
        return () => { cancelled = true; };
    }, [loadingGroup, orgId, reservation.vehicleId, period.startDate, period.startTime, period.plannedEndDate, period.plannedEndTime, vehicle]);

    if (!loan) return null;

    const save = async (startKmValue: string, correction?: { originalStartKm: number }) => {
        const built = buildExternalLoanDriveLog({
            orgId, adminUid, reservation, period, vehicleType: vehicle?.vehicleType,
            startKm: startKmValue, endKm, returnDate, returnTime, notes,
        });
        if (!built.ok) {
            showToast(built.error, 'warning');
            return;
        }
        setSaving(true);
        try {
            try {
                await createDriveLog({
                    id: built.id,
                    ...built.data,
                    ...(correction ? { isManuallyCorrected: true, originalStartKm: correction.originalStartKm } : {}),
                } as Parameters<typeof createDriveLog>[0]);
            } catch (error: unknown) {
                // 출발 km가 직전 기록의 도착 km와 다르다 — 작성 화면과 같이 직전 값을 쓸지 묻는다
                const err = error as { code?: string; suggestedStartKm?: number; originalStartKm?: number };
                if (err?.code === 'REQUIRES_START_KM_CONFIRMATION' && typeof err.suggestedStartKm === 'number') {
                    const useSuggested = await confirm({
                        title: '출발 km 확인',
                        message: `직전 운행의 도착 km는 ${err.suggestedStartKm.toLocaleString()}km입니다.\n출발 km를 이 값으로 바꿔 저장할까요?`,
                        confirmText: '바꿔서 저장',
                        cancelText: '다시 확인',
                        confirmColor: 'primary',
                    });
                    setSaving(false);
                    if (useSuggested) {
                        setStartKm(String(err.suggestedStartKm));
                        await save(String(err.suggestedStartKm), { originalStartKm: Number(startKmValue) });
                    }
                    return;
                }
                throw error;
            }

            // 대여 묶음 닫기 — 첫날을 완료로, 나머지는 반납일까지 완료·그 뒤는 취소
            await updateReservationStatus(period.first.id, 'completed', {
                actualStartTime: period.startTime,
                actualEndTime: period.first.date === returnDate ? returnTime : period.first.endTime,
            });
            const group = await completeReservationGroupSiblings(period.first.id, orgId, returnDate);
            invalidateDashboardCache();
            showToast(group.cancelled > 0
                ? `반납 처리했어요. 반납일 뒤 ${group.cancelled}일의 대여는 취소되어 다시 예약할 수 있어요.`
                : '반납 처리했어요. 운행일지에 기록되었습니다.');
            onDone();
        } catch (error: unknown) {
            captureError(error, { context: 'ExternalLoanReturnModal.save', reservationId: period.first.id });
            showToast(error instanceof Error ? error.message : '반납 처리에 실패했습니다.', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="loan-return-title">
            <div className="bg-white dark:bg-surface-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-slide-up">
                <div className="flex items-center justify-between p-5 border-b border-surface-200 dark:border-surface-700">
                    <h2 id="loan-return-title" className="text-lg font-bold text-surface-800 dark:text-surface-100">🤝 외부 대여 반납</h2>
                    <button type="button" onClick={onClose} aria-label="닫기" className="min-w-[48px] min-h-[48px] text-surface-400 hover:text-surface-600 dark:hover:text-surface-200">✕</button>
                </div>
                <form
                    className="p-5 space-y-3"
                    onSubmit={e => { e.preventDefault(); if (!saving) void save(startKm); }}
                >
                    <p className="text-sm text-surface-600 dark:text-surface-300">
                        <strong>{loan.borrowerOrg}</strong> · {loan.driverName}
                        <span className="block text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                            {reservation.vehicleName} · {period.startDate} {period.startTime} ~ (예정) {period.plannedEndDate} {period.plannedEndTime}
                        </span>
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label htmlFor="loan-start-km" className="label text-xs">출발 km (빌려줄 때)</label>
                            <input id="loan-start-km" type="number" inputMode="numeric" min={0} value={startKm}
                                onChange={e => setStartKm(e.target.value)} className="input w-full text-sm min-h-[48px]" />
                        </div>
                        <div>
                            <label htmlFor="loan-end-km" className="label text-xs">도착 km (돌려받을 때) *</label>
                            <input id="loan-end-km" type="number" inputMode="numeric" min={0} value={endKm}
                                onChange={e => setEndKm(e.target.value)} className="input w-full text-sm min-h-[48px]" />
                        </div>
                        <div>
                            <label htmlFor="loan-return-date" className="label text-xs">반납 날짜</label>
                            <input id="loan-return-date" type="date" value={returnDate} min={period.startDate}
                                onChange={e => { if (e.target.value) setReturnDate(e.target.value); }} className="input w-full text-sm min-h-[48px]" />
                        </div>
                        <div>
                            <label htmlFor="loan-return-time" className="label text-xs">반납 시각</label>
                            <input id="loan-return-time" type="time" value={returnTime}
                                onChange={e => { if (e.target.value) setReturnTime(e.target.value); }} className="input w-full text-sm min-h-[48px]" />
                        </div>
                    </div>
                    <div>
                        <label htmlFor="loan-notes" className="label text-xs">특이사항</label>
                        <input id="loan-notes" type="text" value={notes} onChange={e => setNotes(e.target.value)}
                            className="input w-full text-sm min-h-[48px]" placeholder="예: 주유 상태, 파손 여부" />
                    </div>
                    <p className="text-xs text-surface-500 dark:text-surface-400">
                        대여 기간 전체가 운행일지 한 건으로 기록돼요(운전자: (외부) {loan.borrowerOrg} {loan.driverName}).
                    </p>
                    <div className="flex gap-2 pt-1">
                        <button type="button" onClick={onClose} className="btn-secondary flex-1 min-h-[48px]">닫기</button>
                        <button type="submit" disabled={saving || loadingGroup} className="btn-primary flex-1 min-h-[48px]">
                            {saving ? '저장 중…' : loadingGroup ? '불러오는 중…' : '반납 처리'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
