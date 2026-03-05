/**
 * useReservationCalendar — 예약 캘린더의 상태 관리 + 비즈니스 로직
 * ReservationCalendar에서 추출된 커스텀 훅
 *
 * 리팩토링: 시간 유틸리티/충돌 검사 → utils/reservationUtils
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import useRetry from './useRetry';
import { getCurrentTimeStr, getTodayStr, getMinStartTime, findOverlappingReservation, getAutoTimes, calcEndTime } from './utils/reservationUtils';
import { getVehicles, createReservationSafe, cancelReservation, updateReservation, subscribeReservations, getCustomHolidays, getFavorites, createFavorite, getOrganization, createNotification, getOrganizationMembers } from '../lib/firestore';
import { fetchPublicHolidays } from '../lib/holidayApi';
import { getMultiRoute, parseDestinations, getNavigationDeeplink, isTmapAvailable, VEHICLE_TYPE_TO_CAR_TYPE } from '../lib/tmap';
import { toLocalDateStr } from '../lib/dateUtils';

export default function useReservationCalendar({ isAdmin = false } = {}) {
    const { user, userData } = useAuth();
    const location = useLocation();
    const { showToast } = useToast();
    useRetry();
    const [vehicles, setVehicles] = useState([]);
    const [reservations, setReservations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(toLocalDateStr());
    const [showForm, setShowForm] = useState(false);
    const [sideTab, setSideTab] = useState('list');
    const [submitting, setSubmitting] = useState(false);
    const [form, setForm] = useState({ vehicleId: '', startTime: '09:00', endTime: '22:00', purpose: '', destination: '' });
    const [editingReservation, setEditingReservation] = useState(null);

    const [customHolidayList, setCustomHolidayList] = useState([]);
    const [favorites, setFavorites] = useState([]);
    const [routeInfo, setRouteInfo] = useState(null);
    const [routeLoading, setRouteLoading] = useState(false);
    const [orgAddress, setOrgAddress] = useState('');
    const routeTimerRef = useRef(null);
    const [members, setMembers] = useState([]);
    const [showFavSave, setShowFavSave] = useState(false);
    const [favName, setFavName] = useState('');

    const orgId = userData?.organizationId;

    // 시간 유틸리티는 utils/reservationUtils에서 import
    const todayStr = getTodayStr();
    const isPastDate = selectedDate ? selectedDate < todayStr : false;
    const isToday = selectedDate === todayStr;

    // 초기 데이터 로드 + 구독
    /* eslint-disable react-hooks/exhaustive-deps */
    useEffect(() => {
        if (!orgId) return;
        let unsubReservations;
        const init = async () => {
            try {
                const promises = [
                    getVehicles(orgId),
                    getCustomHolidays(orgId),
                ];
                // 관리자 모드일 때 직원 목록도 함께 로드
                if (isAdmin) promises.push(getOrganizationMembers(orgId));
                const results = await Promise.all(promises);
                setVehicles(results[0]);
                setCustomHolidayList(results[1]);
                if (isAdmin && results[2]) setMembers(results[2]);

                try {
                    const [favs, org] = await Promise.all([
                        getFavorites(user.uid),
                        getOrganization(orgId),
                    ]);
                    setFavorites(favs);
                    if (org?.address) setOrgAddress(org.address);
                } catch { /* 즐겨찾기/기관주소 로드 실패 무시 */ }

                unsubReservations = subscribeReservations(orgId, (allRes) => {
                    setReservations(allRes.filter(rv => rv.status !== 'cancelled'));
                });
            } catch (err) {
                console.error('로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        init();
        return () => {
            if (unsubReservations) unsubReservations();
        };
    }, [orgId]);
    /* eslint-enable react-hooks/exhaustive-deps */

    // 로딩 완료 후 자동 설정
    /* eslint-disable react-hooks/exhaustive-deps */
    useEffect(() => {
        if (!loading) {
            if (selectedDate === todayStr) {
                const { startTime, endTime } = getAutoTimes(selectedDate, routeInfo?.duration);
                setForm(prev => ({ ...prev, startTime, endTime }));
            }
            if (location.state?.openForm) {
                setShowForm(true);
                window.history.replaceState({}, '');
            }
        }
    }, [loading]);
    /* eslint-enable react-hooks/exhaustive-deps */

    // 목적지 또는 차량 변경 시 경로 탐색 (디바운스 800ms)
    useEffect(() => {
        if (routeTimerRef.current) clearTimeout(routeTimerRef.current);
        setRouteInfo(null);

        if (!form.destination.trim() || !orgAddress || !isTmapAvailable()) return;

        routeTimerRef.current = setTimeout(async () => {
            setRouteLoading(true);
            try {
                const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);
                const carType = VEHICLE_TYPE_TO_CAR_TYPE[selectedVehicle?.vehicleType] || '0';
                const result = await getMultiRoute(orgAddress, form.destination.trim(), { carType });
                setRouteInfo(result);
                // Tmap 소요시간 기반 종료시간 자동 계산 (편도 합산 → calcEndTime이 왕복+1시간)
                const duration = result?.duration || 0;
                setForm(prev => ({ ...prev, endTime: calcEndTime(prev.startTime, duration) }));
            } catch (err) {
                console.error('경로 탐색 실패:', err);
            } finally {
                setRouteLoading(false);
            }
        }, 800);

        return () => {
            if (routeTimerRef.current) clearTimeout(routeTimerRef.current);
        };
    }, [form.destination, form.vehicleId, orgAddress, vehicles]);

    // 공휴일 데이터
    const [publicHolidayMap, setPublicHolidayMap] = useState({});

    useEffect(() => {
        let cancelled = false;
        const year = currentDate.getFullYear();
        fetchPublicHolidays(year).then(map => {
            if (!cancelled) setPublicHolidayMap(map);
        });
        return () => { cancelled = true; };
    }, [currentDate]);

    // 공휴일 + 커스텀 휴일 합산
    const holidays = useMemo(() => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const merged = { ...publicHolidayMap };
        customHolidayList.forEach(h => {
            if (h.date && !merged[h.date]) {
                merged[h.date] = h.name;
            }
        });
        const monthMap = {};
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        Object.entries(merged).forEach(([d, name]) => {
            if (d.startsWith(prefix)) monthMap[d] = name;
        });
        return monthMap;
    }, [currentDate, publicHolidayMap, customHolidayList]);

    // 달력 데이터
    const calendarDays = useMemo(() => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startOffset = firstDay.getDay();
        const days = [];
        for (let i = 0; i < startOffset; i++) days.push(null);
        for (let d = 1; d <= lastDay.getDate(); d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayReservations = reservations.filter(r => r.date === dateStr);
            days.push({ date: d, dateStr, reservations: dayReservations, holiday: holidays[dateStr] || null });
        }
        return days;
    }, [currentDate, reservations, holidays]);

    const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
    const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
    const monthLabel = currentDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });

    const selectedReservations = selectedDate
        ? reservations.filter(r => r.date === selectedDate)
        : [];

    const handleDateSelect = (dateStr) => {
        setSelectedDate(dateStr);
        setShowForm(false);
        const { startTime, endTime } = getAutoTimes(dateStr, routeInfo?.duration);
        setForm(prev => ({ ...prev, startTime, endTime }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.vehicleId) {
            showToast('차량을 선택해주세요.', 'warning');
            return;
        }
        if (!form.destination.trim()) {
            showToast('목적지를 입력해주세요.', 'warning');
            return;
        }
        if (!selectedDate) return;

        const overlapping = findOverlappingReservation(reservations, {
            vehicleId: form.vehicleId,
            date: selectedDate,
            startTime: form.startTime,
            endTime: form.endTime,
            excludeId: editingReservation?.id,
        });
        if (overlapping) {
            showToast(`해당 차량은 ${overlapping.startTime} ~ ${overlapping.endTime}에 이미 예약되어 있습니다.`, 'warning');
            return;
        }

        if (selectedDate < todayStr) {
            showToast('과거 날짜에는 예약할 수 없습니다.', 'warning');
            return;
        }

        if (!editingReservation && selectedDate === todayStr && form.startTime < getCurrentTimeStr()) {
            showToast('시작 시간은 현재 시간 이후여야 합니다.', 'warning');
            return;
        }

        setSubmitting(true);
        try {
            const vehicle = vehicles.find(v => v.id === form.vehicleId);

            if (editingReservation) {
                const updateData = {
                    vehicleId: form.vehicleId,
                    vehicleName: vehicle?.displayName || '',
                    startTime: form.startTime,
                    endTime: form.endTime,
                    purpose: form.purpose.trim(),
                    destination: form.destination.trim(),
                    routeDistance: routeInfo?.distance || null,
                    routeDuration: routeInfo?.duration || null,
                    routeTollFee: routeInfo?.tollFee || null,
                };
                // 관리자가 예약자를 변경한 경우
                if (isAdmin && form.reservedByUid) {
                    updateData.reservedByUid = form.reservedByUid;
                    updateData.reservedByName = form.reservedByName;
                }
                await updateReservation(editingReservation.id, updateData);
                // 관리자가 다른 직원의 예약을 수정한 경우 알림 발송
                if (isAdmin && editingReservation.reservedByUid !== user.uid) {
                    try {
                        const destLabel = form.destination.trim();
                        const destDisplay = parseDestinations(destLabel).length > 1
                            ? `[${parseDestinations(destLabel).join(' → ')}]`
                            : destLabel;
                        const parts = [`${selectedDate} ${form.startTime}~${form.endTime}`, vehicle?.displayName, destDisplay].filter(Boolean);
                        await createNotification({
                            targetUid: editingReservation.reservedByUid,
                            title: '예약 변경 안내',
                            message: `관리자가 예약을 수정했습니다: ${parts.join(', ')}`,
                            type: 'reservation_modified',
                        });
                    } catch { /* 알림 실패 무시 */ }
                }
                setReservations(prev => prev.map(r =>
                    r.id === editingReservation.id ? { ...r, ...updateData } : r
                ));
                setEditingReservation(null);
            } else {
                await createReservationSafe({
                    organizationId: orgId,
                    vehicleId: form.vehicleId,
                    vehicleName: vehicle?.displayName || '',
                    reservedByUid: user.uid,
                    reservedByName: userData?.name || user.displayName || user.email,
                    date: selectedDate,
                    startTime: form.startTime,
                    endTime: form.endTime,
                    purpose: form.purpose.trim(),
                    destination: form.destination.trim(),
                    routeDistance: routeInfo?.distance || null,
                    routeDuration: routeInfo?.duration || null,
                    routeTollFee: routeInfo?.tollFee || null,
                });

                try {
                    const reserverName = userData?.name || user.displayName || user.email;
                    const vehicleLabel = vehicle?.displayName || '';
                    const destLabel = form.destination.trim();
                    const destDisplay = parseDestinations(destLabel).length > 1
                        ? `[${parseDestinations(destLabel).join(' → ')}]`
                        : destLabel;
                    const parts = [reserverName, `${selectedDate} ${form.startTime}~${form.endTime}`, vehicleLabel, destDisplay].filter(Boolean);
                    await createNotification({
                        targetUid: user.uid,
                        title: '예약 확정',
                        message: parts.join(', '),
                        type: 'reservation_confirmed',
                    });
                } catch { /* 알림 실패 무시 */ }
            }
            setShowForm(false);
            setSideTab('list');
            setForm({ vehicleId: '', startTime: '09:00', endTime: '22:00', purpose: '', destination: '' });
        } catch (err) {
            console.error(editingReservation ? '수정 실패:' : '예약 실패:', err);
            // Cloud Function의 already-exists 에러 (중복 예약)
            if (err?.code === 'functions/already-exists' || err?.message?.includes('이미 예약')) {
                showToast(err.message || '해당 시간대에 이미 예약이 있습니다.', 'warning');
            } else {
                const msg = editingReservation ? '수정에 실패했습니다.' : '예약에 실패했습니다.';
                showToast(msg, 'error', {
                    actionLabel: '재시도',
                    onAction: () => handleSubmit(new Event('submit')),
                });
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleEdit = (res) => {
        setForm({
            vehicleId: res.vehicleId,
            startTime: res.startTime,
            endTime: res.endTime,
            purpose: res.purpose || '',
            destination: res.destination || '',
            // 관리자 모드일 때 예약자 정보도 폼에 포함
            reservedByUid: res.reservedByUid || '',
            reservedByName: res.reservedByName || '',
        });
        setEditingReservation(res);
        setShowForm(true);
    };

    const handleCancel = async (resId) => {
        if (!confirm('이 예약을 취소하시겠습니까?')) return;
        try {
            const targetRes = reservations.find(r => r.id === resId);
            await cancelReservation(resId);
            // 관리자가 다른 직원의 예약을 취소한 경우 알림 발송
            if (isAdmin && targetRes && targetRes.reservedByUid !== user.uid) {
                try {
                    await createNotification({
                        targetUid: targetRes.reservedByUid,
                        title: '예약 취소 안내',
                        message: `관리자가 ${targetRes.date} ${targetRes.vehicleName} 예약을 취소했습니다`,
                        type: 'reservation_cancelled',
                    });
                } catch { /* 알림 실패 무시 */ }
            }
            setReservations(prev => prev.filter(r => r.id !== resId));
        } catch (err) {
            console.error('취소 실패:', err);
        }
    };

    const handleSaveFavorite = async () => {
        if (!form.destination.trim()) return;
        try {
            await createFavorite({
                userId: user.uid,
                name: favName.trim() || form.destination.trim(),
                address: form.destination.trim(),
                organizationId: orgId,
            });
            const updated = await getFavorites(user.uid);
            setFavorites(updated);
            setShowFavSave(false);
            setFavName('');
        } catch (err) {
            console.error('즐겨찾기 저장 실패:', err);
        }
    };

    return {
        // 상태
        vehicles, loading, currentDate, form, setForm,
        selectedDate, showForm, setShowForm,
        sideTab, setSideTab,
        submitting, editingReservation,
        favorites, routeInfo, routeLoading,
        showFavSave, setShowFavSave,
        favName, setFavName,
        calendarDays, monthLabel, todayStr,
        selectedReservations, isPastDate, isToday,
        user, isAdmin, members,
        // 핸들러
        prevMonth, nextMonth,
        handleDateSelect,
        handleSubmit, handleEdit, handleCancel, handleSaveFavorite,
        getCurrentTimeStr, getMinStartTime: () => getMinStartTime(isToday),
        getNavigationDeeplink,
    };
}
