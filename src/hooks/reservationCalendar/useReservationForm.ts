import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { format, isBefore, startOfDay } from 'date-fns';
import { snapTo30 } from '../utils/reservationUtils';
import type { ReservationForm } from '../../types/reservation';
import type { Reservation } from '../../types/reservation';
import type { RecommendedPattern } from '../useReservationPattern';

export function useReservationForm() {
    const [searchParams] = useSearchParams();
    const location = useLocation();

    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
    const [showForm, setShowForm] = useState(false);
    const [sideTab, setSideTab] = useState<'list' | 'completed'>('list');
    const [submitting, setSubmitting] = useState(false);
    const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
    const [editingRecurringGroupId, setEditingRecurringGroupId] = useState<string | null>(null);
    const [reservationSource, setReservationSource] = useState<string | null>(null);

    // 폼 상태
    const [form, setForm] = useState<ReservationForm>({
        vehicleId: '',
        destination: '',
        purpose: '',
        startTime: '',
        endTime: '',
    });

    // 즐겨찾기 저장 관련
    const [showFavSave, setShowFavSave] = useState(false);
    const [favName, setFavName] = useState('');

    const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

    // URL 파라미터 처리 (날짜 선택) 및 라우트 state 처리 (패턴 prefill 등)
    /* eslint-disable react-hooks/set-state-in-effect -- URL state → React state 초기화는 effect에서 수행 필요 */
    useEffect(() => {
        const dateParam = searchParams.get('date');
        if (dateParam) {
            setSelectedDate(dateParam);
            setCurrentMonth(new Date(dateParam));
        }

        const state = location.state as { openForm?: boolean; prefillPattern?: RecommendedPattern; defaultVehicleId?: string; source?: string } | null;
        if (state?.prefillPattern && state.openForm) {
            if (state.source) {
                setReservationSource(state.source);
            }
            const p = state.prefillPattern;
            setSelectedDate(p.date);
            setCurrentMonth(new Date(p.date));
            setForm({
                vehicleId: p.vehicleId || '',
                destination: p.destination || '',
                purpose: '업무',
                startTime: p.startTime || '',
                endTime: p.endTime || '',
            });
            setShowForm(true);
            window.history.replaceState({}, document.title);
        } else if (state?.openForm) {
            setShowForm(true);
            setForm(prev => {
                const newState = { ...prev };
                if (!newState.vehicleId && state.defaultVehicleId) {
                    newState.vehicleId = state.defaultVehicleId;
                }
                if (!newState.startTime && !newState.endTime) {
                    const now = new Date();
                    const snapped = snapTo30(now.getHours(), now.getMinutes());
                    const startH = snapped.h;
                    const startM = snapped.m;
                    let endH = startH + 1;
                    let endM = startM;
                    if (endH >= 24) { endH = 23; endM = 59; }

                    const defaultStart = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
                    const defaultEnd = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

                    const targetDate = dateParam || format(new Date(), 'yyyy-MM-dd');
                    const isTargetToday = targetDate === format(new Date(), 'yyyy-MM-dd');

                    newState.startTime = isTargetToday ? defaultStart : '09:00';
                    newState.endTime = isTargetToday ? defaultEnd : '10:00';
                }
                return newState;
            });
            window.history.replaceState({}, document.title);
        }
    }, [searchParams, location.state]);
    /* eslint-enable react-hooks/set-state-in-effect */

    const isPastDate = isBefore(startOfDay(new Date(selectedDate)), startOfDay(new Date()));
    const isToday = selectedDate === todayStr;

    // 현재 시간 문자열 (HH:mm)
    const getCurrentTimeStr = () => format(new Date(), 'HH:mm');

    // 최소 시작 시간 (오늘이면 현재 시간, 아니면 00:00)
    const getMinStartTime = () => isToday ? getCurrentTimeStr() : '00:00';

    const handleDateSelect = (dateStr: string) => {
        setSelectedDate(dateStr);
        setEditingReservation(null);
        // 폼이 열려 있으면 닫지 않고 날짜만 변경 (사용자가 날짜를 바꿔도 폼 유지)
        if (!showForm) {
            setForm({
                vehicleId: '',
                destination: '',
                purpose: '',
                startTime: '',
                endTime: '',
                endDate: '',
            });
        }
    };

    const handleOpenForm = (defaultVehicleId?: unknown) => {
        if (showForm) {
            setShowForm(false);
            setEditingReservation(null);
            setForm({ vehicleId: '', destination: '', purpose: '', startTime: '', endTime: '', endDate: '' });
            setReservationSource(null);
            setShowFavSave(false);
            setFavName('');
            return { shouldClearRouteInfo: true };
        }
        // 현재 시간 기반 30분 단위 스냅
        const now = new Date();
        const snapped = snapTo30(now.getHours(), now.getMinutes());
        const startH = snapped.h;
        const startM = snapped.m;
        let endH = startH + 1;
        let endM = startM;
        // 24:00 이상이면 23:59로 캡핑 (HTML time input은 24:00 미지원)
        if (endH >= 24) { endH = 23; endM = 59; }

        const defaultStart = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
        const defaultEnd = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

        const vId = typeof defaultVehicleId === 'string' ? defaultVehicleId : '';

        setForm(prev => ({
            ...prev,
            vehicleId: prev.vehicleId || vId,
            startTime: prev.startTime || (isToday ? defaultStart : '09:00'),
            endTime: prev.endTime || (isToday ? defaultEnd : '10:00'),
        }));
        setShowForm(true);
        return { shouldClearRouteInfo: false };
    };

    const resetFormState = () => {
        setShowForm(false);
        setEditingReservation(null);
        setEditingGroupId(null);
        setEditingRecurringGroupId(null);
        setForm({ vehicleId: '', destination: '', purpose: '', startTime: '', endTime: '', endDate: '' });
        setReservationSource(null);
    };

    return {
        currentMonth,
        setCurrentMonth,
        selectedDate,
        setSelectedDate,
        showForm,
        setShowForm,
        sideTab,
        setSideTab,
        submitting,
        setSubmitting,
        editingReservation,
        setEditingReservation,
        editingGroupId,
        setEditingGroupId,
        editingRecurringGroupId,
        setEditingRecurringGroupId,
        reservationSource,
        setReservationSource,
        form,
        setForm,
        showFavSave,
        setShowFavSave,
        favName,
        setFavName,
        todayStr,
        isPastDate,
        isToday,
        getCurrentTimeStr,
        getMinStartTime,
        handleDateSelect,
        handleOpenForm,
        resetFormState,
    };
}
