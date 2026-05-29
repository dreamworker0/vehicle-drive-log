import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { useConfirm } from './useConfirm';
import { format, addMonths, subMonths } from 'date-fns';
import { useReservationData } from './reservationCalendar/useReservationData';
import { useReservationForm } from './reservationCalendar/useReservationForm';
import { useRouteInfo } from './reservationCalendar/useRouteInfo';
import {
    handleSubmit as handleSubmitAction,
    handleEdit as handleEditAction,
    handleCancel as handleCancelAction,
    handleSaveFavorite as handleSaveFavoriteAction,
} from './reservationCalendar/reservationActions';
import type { Reservation } from '../types/reservation';

export default function useReservationCalendar({ isAdmin = false } = {}) {
    const { user, userData } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();

    // ── Form state (dates, editing state, UI toggles) ──
    const formHook = useReservationForm();
    const {
        currentMonth, setCurrentMonth,
        selectedDate, setSelectedDate,
        showForm, setShowForm,
        sideTab, setSideTab,
        submitting, setSubmitting,
        editingReservation, setEditingReservation,
        editingGroupId, setEditingGroupId,
        editingRecurringGroupId, setEditingRecurringGroupId,
        reservationSource,
        form, setForm,
        showFavSave, setShowFavSave,
        favName, setFavName,
        todayStr, isPastDate, isToday,
        getCurrentTimeStr, getMinStartTime,
        handleDateSelect, handleOpenForm: rawHandleOpenForm,
        resetFormState,
    } = formHook;

    // ── Data loading (vehicles, reservations, holidays, members, favorites) ──
    const dataHook = useReservationData({
        user, userData, isAdmin, showToast, currentMonth,
    });
    const {
        vehicles, reservations, setReservations, loading,
        favorites, setFavorites, holidays, members, orgAddress,
        calendarDays,
    } = dataHook;

    // ── Route info (tmap debounce, auto end-time) ──
    const { routeInfo, setRouteInfo, routeLoading, freeRoadRoute, freeRoadLoading, handleFetchFreeRoad } = useRouteInfo({
        form, setForm, orgAddress, vehicles,
    });

    // ── Derived values ──
    const monthLabel = format(currentMonth, 'yyyy년 M월');
    const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
    const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

    const selectedReservations = useMemo(() =>
        reservations.filter(r => r.date === selectedDate)
            .sort((a, b) => a.startTime.localeCompare(b.startTime)),
        [reservations, selectedDate]);

    // ── Wrap handleOpenForm to also clear routeInfo ──
    const handleOpenForm = (defaultVehicleId?: unknown) => {
        const result = rawHandleOpenForm(defaultVehicleId);
        if (result?.shouldClearRouteInfo) {
            setRouteInfo(null);
        }
    };

    // ── Action wrappers (forward deps) ──
    const handleSubmit = (e: React.FormEvent) =>
        handleSubmitAction(e, {
            user: user!,
            userData: userData!,
            form, selectedDate, currentMonth,
            vehicles, reservations, holidays,
            routeInfo, reservationSource,
            editingReservation, editingGroupId, editingRecurringGroupId,
            showToast, confirm,
            setSubmitting, setReservations, resetFormState, setRouteInfo,
        });

    const handleEdit = (res: Reservation) =>
        handleEditAction(res, {
            reservations,
            setEditingReservation, setEditingGroupId, setEditingRecurringGroupId,
            setSelectedDate, setForm, setShowForm,
        });

    const handleCancel = (id: string) =>
        handleCancelAction(id, {
            reservations, userData, showToast, confirm, setReservations,
        });

    const handleSaveFavorite = () =>
        handleSaveFavoriteAction({
            user: user!, userData, form, favName,
            showToast, setFavorites, setShowFavSave, setFavName,
        });

    const getNavigationDeeplink = (dest: string) => {
        return `https://map.kakao.com/link/to/${dest}`;
    };

    return {
        vehicles, loading, form, setForm,
        selectedDate, showForm, setShowForm,
        sideTab, setSideTab,
        submitting, editingReservation, editingGroupId, editingRecurringGroupId,
        favorites, routeInfo, routeLoading, freeRoadRoute, freeRoadLoading, handleFetchFreeRoad,
        showFavSave, setShowFavSave,
        favName, setFavName,
        calendarDays, monthLabel, todayStr,
        selectedReservations, isPastDate, isToday,
        user, members,
        prevMonth, nextMonth,
        handleDateSelect,
        handleSubmit, handleEdit, handleCancel, handleSaveFavorite, handleOpenForm,
        getCurrentTimeStr, getMinStartTime,
        getNavigationDeeplink,
        holidays, reservations,
    };
}
