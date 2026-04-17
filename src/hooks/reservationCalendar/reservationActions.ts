import {
    createReservationSafe,
    updateReservation,
    cancelReservation,
    cancelReservationGroup,
    deleteReservationGroup,
    cancelRecurringGroup,
    deleteRecurringGroup,
    getFavorites,
    createFavorite,
    getReservationsByDateRange,
} from '../../lib/firestore';
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { findOverlappingReservation, findUserOverlappingReservation } from '../utils/reservationUtils';
import { generateRecurringDates, generateRecurringGroupId } from '../utils/recurringUtils';
import type { Vehicle } from '../../types/vehicle';
import type { Reservation, ReservationForm } from '../../types/reservation';
import type { CustomHoliday } from '../../types/holiday';
import type { Favorite } from '../../types/favorite';
import type { RouteInfoData } from './useRouteInfo';
import { invalidateDashboardCache } from '../useTodayDashboard';

// ─── Shared dependency types ─────────────────────────────────────

export interface ActionDeps {
    user: { uid: string; email?: string | null };
    userData: { organizationId?: string | null; name?: string };
    form: ReservationForm;
    selectedDate: string;
    currentMonth: Date;
    vehicles: Vehicle[];
    reservations: Reservation[];
    holidays: CustomHoliday[];
    routeInfo: RouteInfoData | null;
    reservationSource: string | null;
    editingReservation: Reservation | null;
    editingGroupId: string | null;
    editingRecurringGroupId: string | null;
    showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
    confirm: (opts: {
        title?: string;
        message: string;
        confirmText?: string;
        cancelText?: string;
        confirmColor?: 'primary' | 'danger' | 'warning';
    }) => Promise<boolean | string | null>;
    setSubmitting: (v: boolean) => void;
    setReservations: React.Dispatch<React.SetStateAction<Reservation[]>>;
    resetFormState: () => void;
    setRouteInfo: (v: RouteInfoData | null) => void;
}

// ─── handleSubmit ────────────────────────────────────────────────

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
    const vehicleOverlap = findOverlappingReservation(reservations, {
        vehicleId: form.vehicleId,
        date: selectedDate,
        startTime: form.startTime,
        endTime: isMultiDay ? '23:59' : form.endTime,
        excludeId: editingReservation?.id || null,
    });
    if (vehicleOverlap) {
        showToast(`해당 차량은 ${vehicleOverlap.startTime} ~ ${vehicleOverlap.endTime}에 이미 예약되어 있습니다.`, 'warning');
        return;
    }

    // 같은 사용자가 같은 시간대에 다른 차량 예약이 있는지 검증 (첫째 날 기준)
    const targetUid = form.reservedByUid || user.uid;
    const userOverlap = findUserOverlappingReservation(reservations, {
        reservedByUid: targetUid,
        date: selectedDate,
        startTime: form.startTime,
        endTime: isMultiDay ? '23:59' : form.endTime,
        excludeId: editingReservation?.id || null,
    });
    if (userOverlap && !isRecurring) {
        showToast('같은 시간대에 2대의 차량을 예약할 수 없습니다.', 'warning');
        return;
    }

    setSubmitting(true);
    try {
        // 선택된 차량 이름 조회
        const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);
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
        } else if (editingReservation) {
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
        } else {
            // ── 단일 날짜 예약 (기존 로직) ──
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
            const recurringStartDate = form.recurringStartDate || selectedDate;
            const recurringDates = generateRecurringDates({
                startDate: recurringStartDate,
                endDate: form.recurringEndDate || recurringStartDate,
                selectedDays: form.recurringDays || [],
                holidays: holidays.map(h => ({ date: h.date, name: h.name })),
                excludeHolidays: form.excludeHolidays ?? true,
                excludedDates: form.excludedDates,
            });

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
            await deleteRecurringGroup(editingRecurringGroupId, userData.organizationId!);

            const recurringStartDate2 = form.recurringStartDate || selectedDate;
            const recurringDates = generateRecurringDates({
                startDate: recurringStartDate2,
                endDate: form.recurringEndDate || recurringStartDate2,
                selectedDays: form.recurringDays || [],
                holidays: holidays.map(h => ({ date: h.date, name: h.name })),
                excludeHolidays: form.excludeHolidays ?? true,
                excludedDates: form.excludedDates,
            });

            if (recurringDates.length === 0) {
                showToast('반복 예약할 날짜가 없습니다.', 'warning');
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

// ─── handleEdit ──────────────────────────────────────────────────

export interface EditDeps {
    reservations: Reservation[];
    setEditingReservation: (r: Reservation | null) => void;
    setEditingGroupId: (id: string | null) => void;
    setEditingRecurringGroupId: (id: string | null) => void;
    setSelectedDate: (d: string) => void;
    setForm: React.Dispatch<React.SetStateAction<ReservationForm>>;
    setShowForm: (v: boolean) => void;
}

export function handleEdit(res: Reservation, deps: EditDeps) {
    const {
        reservations,
        setEditingReservation, setEditingGroupId, setEditingRecurringGroupId,
        setSelectedDate, setForm, setShowForm,
    } = deps;

    if (res.recurringGroupId) {
        // 반복 예약 그룹 수정 — 그룹의 모든 활성 예약 조회
        const groupReservations = reservations
            .filter(r => r.recurringGroupId === res.recurringGroupId && r.status !== 'cancelled')
            .sort((a, b) => a.date.localeCompare(b.date));

        if (groupReservations.length > 0) {
            const first = groupReservations[0];
            const last = groupReservations[groupReservations.length - 1];

            // 요일 패턴 추출 (그룹 내 고유 요일)
            const daySet = new Set(groupReservations.map(r => new Date(r.date + 'T00:00').getDay()));

            setEditingReservation(res);
            setEditingRecurringGroupId(res.recurringGroupId!);
            setEditingGroupId(null);
            setSelectedDate(first.date);
            setForm({
                vehicleId: first.vehicleId,
                destination: first.destination || '',
                purpose: first.purpose || '',
                startTime: first.startTime,
                endTime: first.endTime,
                reservedByUid: first.reservedByUid,
                reservedByName: first.reservedByName,
                isRecurring: true,
                recurringDays: [...daySet].sort(),
                recurringEndDate: last.date,
                excludeHolidays: true,
                excludedDates: [],
            });
            setShowForm(true);
            return;
        }
    }

    if (res.groupId) {
        // 그룹의 전체 예약 찾기
        const groupReservations = reservations
            .filter(r => r.groupId === res.groupId && r.status !== 'cancelled')
            .sort((a, b) => a.date.localeCompare(b.date));

        if (groupReservations.length > 0) {
            const first = groupReservations[0];
            const last = groupReservations[groupReservations.length - 1];
            setEditingReservation(res);
            setEditingGroupId(res.groupId);
            setSelectedDate(first.date);
            setForm({
                vehicleId: first.vehicleId,
                destination: first.destination || '',
                purpose: first.purpose || '',
                startTime: first.startTime,
                endTime: last.endTime,
                endDate: last.date !== first.date ? last.date : '',
                reservedByUid: first.reservedByUid,
                reservedByName: first.reservedByName,
            });
            setShowForm(true);
            return;
        }
    }
    // 단건 수정
    setEditingReservation(res);
    setEditingGroupId(null);
    setForm({
        vehicleId: res.vehicleId,
        destination: res.destination || '',
        purpose: res.purpose || '',
        startTime: res.startTime,
        endTime: res.endTime,
        reservedByUid: res.reservedByUid,
        reservedByName: res.reservedByName
    });
    setShowForm(true);
}

// ─── handleCancel ────────────────────────────────────────────────

export interface CancelDeps {
    reservations: Reservation[];
    userData: { organizationId?: string | null } | null;
    showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
    confirm: (opts: {
        title?: string;
        message: string;
        confirmText?: string;
        cancelText?: string;
        confirmColor?: 'primary' | 'danger' | 'warning';
    }) => Promise<boolean | string | null>;
    setReservations: React.Dispatch<React.SetStateAction<Reservation[]>>;
}

export async function handleCancel(id: string, deps: CancelDeps) {
    const { reservations, userData, showToast, confirm, setReservations } = deps;
    const target = reservations.find(r => r.id === id);

    // ── 반복 예약 취소 ──
    if (target?.recurringGroupId) {
        const rGroupId = target.recurringGroupId;
        const groupCount = reservations.filter(r => r.recurringGroupId === rGroupId && r.status !== 'cancelled' && r.status !== 'completed').length;

        const choice = await confirm({
            title: '반복 예약 취소',
            message: `이 예약은 반복 예약 그룹(${groupCount}건)의 일부입니다.\n\n이 날짜만 취소하시겠습니까, 아니면 전체 반복 예약을 취소하시겠습니까?`,
            confirmText: '전체 취소',
            cancelText: '이 날짜만',
            confirmColor: 'danger',
        });

        if (choice === null || choice === undefined) return; // 다이얼로그 닫기

        try {
            if (choice) {
                // 전체 취소
                const cancelled = await cancelRecurringGroup(rGroupId, userData?.organizationId || '');
                showToast(`반복 예약 ${cancelled}건이 취소되었습니다.`);
                setReservations(prev => prev.map(r => r.recurringGroupId === rGroupId ? { ...r, status: 'cancelled' } : r));
                invalidateDashboardCache();
            } else {
                // 이 날짜만 취소
                await cancelReservation(id);
                showToast('해당 날짜의 예약이 취소되었습니다.');
                setReservations(prev => prev.map(r => r.id === id ? { ...r, status: 'cancelled' } : r));
                invalidateDashboardCache();
            }
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : '취소에 실패했습니다.';
            showToast(errMsg, 'error');
        }
        return;
    }

    // ── 연속 다일 예약 취소 ──
    const groupId = target?.groupId;

    if (groupId) {
        // 그룹 예약: 전체 취소 확인
        const groupCount = reservations.filter(r => r.groupId === groupId && r.status !== 'cancelled' && r.status !== 'completed').length;
        const choice = await confirm({
            title: '다일 예약 취소',
            message: `이 예약은 ${groupCount}일간 다일 예약의 일부입니다.\n\n전체 다일 예약을 취소하시겠습니까?`,
            confirmText: '전체 취소',
            cancelText: '돌아가기',
            confirmColor: 'danger',
        });

        if (!choice) return;

        try {
            const cancelled = await cancelReservationGroup(groupId, userData?.organizationId || '');
            showToast(`다일 예약 ${cancelled}건이 취소되었습니다.`);
            setReservations(prev => prev.map(r => r.groupId === groupId ? { ...r, status: 'cancelled' } : r));
            invalidateDashboardCache();
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : '취소에 실패했습니다.';
            showToast(errMsg, 'error');
        }
    } else {
        // 단일 예약: 기존 로직
        if (!await confirm({ message: '예약을 취소하시겠습니까?', confirmColor: 'danger' })) return;

        try {
            await cancelReservation(id);
            showToast('예약이 취소되었습니다.');
            setReservations(prev => prev.filter(r => r.id !== id));
            invalidateDashboardCache();
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : '취소에 실패했습니다.';
            showToast(errMsg, 'error');
        }
    }
}

// ─── handleSaveFavorite ──────────────────────────────────────────

export interface SaveFavoriteDeps {
    user: { uid: string };
    userData: { organizationId?: string | null } | null;
    form: ReservationForm;
    favName: string;
    showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
    setFavorites: React.Dispatch<React.SetStateAction<Favorite[]>>;
    setShowFavSave: (v: boolean) => void;
    setFavName: (v: string) => void;
}

export async function handleSaveFavorite(deps: SaveFavoriteDeps) {
    const { user, userData, form, favName, showToast, setFavorites, setShowFavSave, setFavName } = deps;
    if (!user || !form.destination.trim()) return;
    try {
        await createFavorite({
            userId: user.uid,
            name: favName || form.destination,
            address: form.destination,
            organizationId: userData?.organizationId || ''
        });
        showToast('즐겨찾기에 저장되었습니다.');
        const fList = await getFavorites(user.uid);
        setFavorites(fList as Favorite[]);
        setShowFavSave(false);
        setFavName('');
    } catch {
        showToast('즐겨찾기 저장에 실패했습니다.', 'error');
    }
}
