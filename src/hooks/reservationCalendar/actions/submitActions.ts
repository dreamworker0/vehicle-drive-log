/**
 * actions/submitActions.ts
 * 예약 생성/수정 (handleSubmit) — 단일 / 다일 / 반복 예약 모두 처리
 */
import {
    createReservationSafe,
    updateReservation,
    deleteReservationGroup,
    deleteRecurringGroup,
    getReservationsByDateRange,
} from '../../../lib/firestore';
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { findOverlappingReservation, getCurrentTimeStr, getTodayStr } from '../../utils/reservationUtils';
import { isVehicleRestrictedForUser } from '../../../lib/vehicleUtils';
import { generateRecurringDates, generateRecurringGroupId } from '../../utils/recurringUtils';
import type { Reservation } from '../../../types/reservation';
import { invalidateDashboardCache } from '../../useTodayDashboard';
import type { ActionDeps } from './types';

export async function handleSubmit(e: React.FormEvent, deps: ActionDeps) {
    e.preventDefault();
    const {
        user, userData, form, selectedDate, currentMonth,
        vehicles, reservations, holidays, routeInfo, reservationSource,
        editingReservation, editingGroupId, editingRecurringGroupId,
        showToast, confirm, setSubmitting, setReservations, resetFormState, setRouteInfo,
    } = deps;

    if (!user || !userData?.organizationId) return;
    if (!form.vehicleId || !form.destination || !form.startTime || !form.endTime) {
        showToast('필수 정보를 입력해주세요.', 'warning');
        return;
    }

    // 다일 예약 여부 판단
    const isRecurring = !!form.isRecurring;
    const effectiveEndDate = form.endDate || selectedDate;
    const isMultiDay = !isRecurring && effectiveEndDate > selectedDate;

    // 반복 그룹 수정 중에 반복을 끄면 "다시 만들 대상"이 사라진다.
    // 예전에는 이 상태로 제출하면 폼을 그대로 단건 저장하려다 undefined 필드로 실패했고,
    // 그 뒤 그룹 재생성 블록이 빈 날짜 목록을 만나 **그룹만 지워질 수 있었다.**
    if (editingRecurringGroupId && !isRecurring) {
        showToast('반복 예약 수정 중에는 반복 설정을 끌 수 없습니다. 단건으로 바꾸려면 반복 예약을 취소하고 새로 예약해주세요.', 'warning');
        return;
    }

    // 반복 예약 대상 날짜 — 검증(지난 시간·충돌)과 실제 생성이 같은 목록을 봐야 한다
    const recurringStartDate = form.recurringStartDate || selectedDate;
    const recurringDates = isRecurring
        ? generateRecurringDates({
            startDate: recurringStartDate,
            endDate: form.recurringEndDate || recurringStartDate,
            selectedDays: form.recurringDays || [],
            holidays: holidays.map(h => ({ date: h.date, name: h.name })),
            excludeHolidays: form.excludeHolidays ?? true,
            excludedDates: form.excludedDates,
        })
        : [];

    // 시간 유효성은 입력 중이 아니라 여기서 판정한다.
    // 입력 도중의 중간값으로 되돌리면 오전↔오후 전환조차 불가능해진다(ReservationSidePanel 주석).
    if (form.endTime <= form.startTime) {
        showToast('종료 시간은 시작 시간보다 늦어야 합니다.', 'warning');
        return;
    }

    // 지난 시간으로 옮기는 것만 막는다. 이미 시작 시간이 지난 예약의 목적지·차량만 고치는 것은
    // 막을 이유가 없으므로, 시간을 실제로 바꿨을 때(또는 신규 생성일 때)만 판정한다.
    const startTimeChanged = !editingReservation || form.startTime !== editingReservation.startTime;
    const firstTargetDate = isRecurring ? recurringDates[0] : selectedDate;
    if (startTimeChanged && firstTargetDate === getTodayStr() && form.startTime < getCurrentTimeStr()) {
        showToast(
            isRecurring
                ? '오늘 회차의 시작 시간이 이미 지났습니다. 미리보기에서 오늘 날짜를 제외하거나 시작일·시간을 조정해주세요.'
                : '이미 지난 시간으로는 예약할 수 없습니다.',
            'warning',
        );
        return;
    }

    // 업무 시간 외 (18:00 ~ 익일 08:59) 예약 확인
    if (form.startTime >= '18:00' || form.startTime < '09:00') {
        const isConfirmed = await confirm({
            title: '예약 시간 확인',
            message: '저녁 6시 이후나 아침 9시 이전 예약이 맞습니까?',
            confirmText: '예',
            cancelText: '아니요',
            confirmColor: 'primary',
        });
        if (!isConfirmed) {
            return;
        }
    }

    // 같은 차량이 같은 시간대에 이미 예약되어 있는지 검증 (클라이언트 사전 검사)
    //
    // 그룹 수정은 기존 예약을 지우고 다시 만드는 방식이라 **수정 중인 그룹 자신은 충돌이 아니다.**
    // 단건 excludeId만 넘기면 그룹의 나머지 날짜가 그대로 걸려 시간을 바꿀 수 없다.
    if (isRecurring) {
        // 반복 예약은 selectedDate가 아니라 실제로 만들어질 날짜들을 봐야 한다.
        // (selectedDate는 반복 기간 밖일 수 있어, 그 날의 남의 예약 때문에 엉뚱하게 막히던 자리다.)
        const conflictDate = recurringDates.find(dateStr => findOverlappingReservation(reservations, {
            vehicleId: form.vehicleId,
            date: dateStr,
            startTime: form.startTime,
            endTime: form.endTime,
            excludeRecurringGroupId: editingRecurringGroupId,
        }));
        if (conflictDate) {
            showToast(`${conflictDate}에 해당 차량이 이미 예약되어 있습니다. 미리보기에서 그 날짜를 제외하거나 시간을 조정해주세요.`, 'warning');
            return;
        }
    } else {
        const vehicleOverlap = findOverlappingReservation(reservations, {
            vehicleId: form.vehicleId,
            date: selectedDate,
            startTime: form.startTime,
            endTime: isMultiDay ? '23:59' : form.endTime,
            excludeId: editingReservation?.id || null,
            excludeGroupId: editingGroupId,
        });
        if (vehicleOverlap) {
            showToast(`해당 차량은 ${vehicleOverlap.startTime} ~ ${vehicleOverlap.endTime}에 이미 예약되어 있습니다.`, 'warning');
            return;
        }
    }

    // 한 사람이 같은 시간대에 여러 대의 차량을 예약하는 것은 허용한다 (행사·대규모 외근 대응).
    // 서버 코어(createReservationCore)도 차량 기준 겹침만 검사하므로 클라이언트에서도 막지 않는다.

    // 차량별 사용 가능 직원 제한 검증 (UI 비활성의 방어적 이중 체크, 서버 콜러블에서도 재검증됨)
    const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);
    if (selectedVehicle && isVehicleRestrictedForUser(selectedVehicle, user.uid)) {
        showToast('이 차량은 지정된 직원만 예약할 수 있습니다.', 'warning');
        return;
    }

    setSubmitting(true);
    try {
        const vehicleName = selectedVehicle?.displayName || selectedVehicle?.name || '';

        // 경로 정보 (routeInfo가 있으면 포함)
        const routeData = routeInfo ? {
            routeDistance: routeInfo.distance,
            routeDuration: routeInfo.duration,
            routeTollFee: routeInfo.tollFee || 0,
        } : {};

        if (editingReservation && editingGroupId) {
            // ── 다일 예약 그룹 수정: 기존 그룹 삭제 → 새 그룹 재생성 ──
            await deleteReservationGroup(editingGroupId, userData.organizationId!);

            const newGroupId = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const effectiveEndDateForGroup = form.endDate || selectedDate;
            const startD = new Date(selectedDate + 'T00:00');
            const endD = new Date(effectiveEndDateForGroup + 'T00:00');
            const days = eachDayOfInterval({ start: startD, end: endD });
            const totalDays = days.length;

            const baseData = {
                vehicleId: form.vehicleId,
                vehicleName,
                destination: form.destination,
                purpose: form.purpose,
                reservedByUid: form.reservedByUid || user.uid,
                reservedByName: form.reservedByName || userData.name || user.email || '익명',
                organizationId: userData.organizationId,
                groupId: newGroupId,
                ...routeData,
                ...(reservationSource ? { source: reservationSource } : {}),
            };

            for (let i = 0; i < totalDays; i++) {
                const dayStr = format(days[i], 'yyyy-MM-dd');
                const dayStartTime = i === 0 ? form.startTime : '00:00';
                const dayEndTime = i === totalDays - 1 ? form.endTime : '23:59';
                await createReservationSafe({
                    ...baseData,
                    date: dayStr,
                    startTime: dayStartTime,
                    endTime: dayEndTime,
                });
            }
            showToast(`${totalDays}일간 다일 예약이 수정되었습니다.`);
        } else if (editingReservation && !editingRecurringGroupId) {
            // 반복 그룹 수정은 아래 전용 블록이 그룹째 다시 만든다.
            // 이 분기가 그것까지 받아 단건 저장을 시도하면, 폼에 남은 반복 설정 필드가
            // 예약 문서에 섞여 들어가거나 undefined 값으로 저장이 실패한다.
            await updateReservation(editingReservation.id, {
                ...form,
                vehicleName,
                ...routeData,
                organizationId: userData.organizationId,
            });
            showToast('예약이 수정되었습니다.');
        } else if (isMultiDay) {
            // ── 다일 연속 예약 생성 ──
            const groupId = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const startD = new Date(selectedDate + 'T00:00');
            const endD = new Date(effectiveEndDate + 'T00:00');
            const days = eachDayOfInterval({ start: startD, end: endD });
            const totalDays = days.length;

            const baseData = {
                vehicleId: form.vehicleId,
                vehicleName,
                destination: form.destination,
                purpose: form.purpose,
                reservedByUid: form.reservedByUid || user.uid,
                reservedByName: form.reservedByName || userData.name || user.email || '익명',
                organizationId: userData.organizationId,
                groupId,
                ...routeData,
                ...(reservationSource ? { source: reservationSource } : {}),
            };

            for (let i = 0; i < totalDays; i++) {
                const dayStr = format(days[i], 'yyyy-MM-dd');
                const dayStartTime = i === 0 ? form.startTime : '00:00';
                const dayEndTime = i === totalDays - 1 ? form.endTime : '23:59';
                await createReservationSafe({
                    ...baseData,
                    date: dayStr,
                    startTime: dayStartTime,
                    endTime: dayEndTime,
                });
            }
            showToast(`${totalDays}일간 다일 예약이 완료되었습니다.`);
        } else if (!isRecurring) {
            // ── 단일 날짜 예약 (기존 로직) ──
            // 반복 예약은 아래 전용 블록에서 모든 날짜를 일괄 생성하므로 여기서 단일 생성하지 않는다.
            // (과거 이 분기가 selectedDate에 단일 예약을 먼저 만들어 반복 루프 첫 날짜와 409 충돌을 일으켰음)
            await createReservationSafe({
                ...form,
                vehicleName,
                ...routeData,
                date: selectedDate,
                reservedByUid: user.uid,
                reservedByName: userData.name || user.email || '익명',
                organizationId: userData.organizationId,
                ...(reservationSource ? { source: reservationSource } : {}),
            });
            showToast('예약이 완료되었습니다.');
        }

        // ── 반복 예약 생성 ──
        if (isRecurring && !editingRecurringGroupId && !editingReservation) {
            if (recurringDates.length === 0) {
                showToast('반복 예약할 날짜가 없습니다. 요일과 기간을 확인해주세요.', 'warning');
                setSubmitting(false);
                return;
            }

            const rGroupId = generateRecurringGroupId();
            const baseData = {
                vehicleId: form.vehicleId,
                vehicleName,
                destination: form.destination,
                purpose: form.purpose,
                reservedByUid: form.reservedByUid || user.uid,
                reservedByName: form.reservedByName || userData.name || user.email || '익명',
                organizationId: userData.organizationId,
                recurringGroupId: rGroupId,
                startTime: form.startTime,
                endTime: form.endTime,
                ...routeData,
                ...(reservationSource ? { source: reservationSource } : {}),
            };

            // 충돌이 아닌 날짜만 생성 (사용자가 미리보기에서 확인함)
            for (const dateStr of recurringDates) {
                await createReservationSafe({
                    ...baseData,
                    date: dateStr,
                });
            }
            showToast(`🔄 반복 예약 ${recurringDates.length}건이 생성되었습니다.`);
        }

        // ── 반복 예약 그룹 수정 ──
        if (editingRecurringGroupId) {
            // 삭제보다 검증이 **먼저**다. 지우고 나서 만들 날짜가 없다는 것을 알면
            // 그룹만 사라지고 아무것도 남지 않는다 (되돌릴 방법이 없다).
            if (recurringDates.length === 0) {
                showToast('반복 예약할 날짜가 없습니다.', 'warning');
                setSubmitting(false);
                return;
            }

            await deleteRecurringGroup(editingRecurringGroupId, userData.organizationId!);

            const rGroupId = generateRecurringGroupId();
            const baseData = {
                vehicleId: form.vehicleId,
                vehicleName,
                destination: form.destination,
                purpose: form.purpose,
                reservedByUid: form.reservedByUid || user.uid,
                reservedByName: form.reservedByName || userData.name || user.email || '익명',
                organizationId: userData.organizationId,
                recurringGroupId: rGroupId,
                startTime: form.startTime,
                endTime: form.endTime,
                ...routeData,
            };

            for (const dateStr of recurringDates) {
                await createReservationSafe({
                    ...baseData,
                    date: dateStr,
                });
            }
            showToast(`🔄 반복 예약 ${recurringDates.length}건이 수정되었습니다.`);
        }

        // 목록 새로고침
        const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
        const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd');
        const res = await getReservationsByDateRange(userData.organizationId, start, end);
        setReservations(res as Reservation[]);

        invalidateDashboardCache();
        resetFormState();
        setRouteInfo(null);
    } catch (error: unknown) {
        // Cloud Function already-exists 에러 처리
        const firebaseErr = error as { code?: string; message?: string };
        const errMsg = firebaseErr?.code === 'functions/already-exists'
            ? firebaseErr.message || '예약 처리에 실패했습니다.'
            : error instanceof Error ? error.message : '예약 처리에 실패했습니다.';
        showToast(errMsg, 'error');
    } finally {
        setSubmitting(false);
    }
}
