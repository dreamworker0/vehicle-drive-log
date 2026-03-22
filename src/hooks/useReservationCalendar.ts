import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useConfirm } from './useConfirm';
import {
    getVehicles,
    getReservationsByDateRange,
    createReservationSafe,
    updateReservation,
    cancelReservation,
    cancelReservationGroup,
    deleteReservationGroup,
    getFavorites,
    createFavorite,
    getOrganizationMembers,
    getOrganization
} from '../lib/firestore';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { getHolidays } from '../lib/holiday';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isBefore, startOfDay } from 'date-fns';
import { getMultiRouteWithFreeRoad, isTmapAvailable, VEHICLE_TYPE_TO_CAR_TYPE } from '../lib/tmap';
import { calcEndTime, findOverlappingReservation, findUserOverlappingReservation, snapTo30 } from './utils/reservationUtils';
import type { Vehicle } from '../types/vehicle';
import type { Reservation, CalendarDay } from '../types/reservation';
import type { CustomHoliday } from '../types/holiday';
import type { Favorite } from '../types/favorite';
import type { User as UserDoc } from '../types/user';

interface ReservationForm {
    vehicleId: string;
    destination: string;
    purpose: string;
    startTime: string;
    endTime: string;
    endDate?: string;
    reservedByUid?: string;
    reservedByName?: string;
}

export default function useReservationCalendar({ isAdmin = false } = {}) {
    const { user, userData } = useAuth();
    const [searchParams] = useSearchParams();
    const { showToast } = useToast();
    const { confirm } = useConfirm();

    // 상태 관리
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
    const [showForm, setShowForm] = useState(false);
    const [sideTab, setSideTab] = useState<'list' | 'completed'>('list');
    const [submitting, setSubmitting] = useState(false);
    const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
    const [favorites, setFavorites] = useState<Favorite[]>([]);
    const [holidays, setHolidays] = useState<CustomHoliday[]>([]);
    const [members, setMembers] = useState<UserDoc[]>([]);
    const [orgAddress, setOrgAddress] = useState('');

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

    // 경로 정보 상태
    const [routeInfo, setRouteInfo] = useState<{ distance: number; duration: number; tollFee?: number; freeRoadRoute?: { distance: number; duration: number; tollFee: number } } | null>(null);
    const [routeLoading, setRouteLoading] = useState(false);

    const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

    // 초기 데이터 로드
    useEffect(() => {
        if (!user || !userData?.organizationId) { setLoading(false); return; }

        const fetchData = async () => {
            try {
                setLoading(true);
                const [vList, fList, hList, org] = await Promise.all([
                    getVehicles(userData.organizationId!),
                    getFavorites(user.uid),
                    getHolidays(),
                    getOrganization(userData.organizationId!)
                ]);
                setVehicles(vList as Vehicle[]);
                setFavorites(fList as Favorite[]);
                setHolidays(hList as CustomHoliday[]);
                const orgData = org as unknown as { address?: string } | null;
                if (orgData?.address) {
                    setOrgAddress(orgData.address);
                }

                if (isAdmin) {
                    const mList = await getOrganizationMembers(userData.organizationId!);
                    setMembers(mList as UserDoc[]);
                }
            } catch (error) {
                console.error('Data fetch error:', error);
                showToast('데이터를 불러오는데 실패했습니다.', 'error');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [user, userData, isAdmin, showToast]);

    // 예약 목록 로드 (월 변경 시)
    useEffect(() => {
        if (!userData?.organizationId) return;

        const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
        const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

        getReservationsByDateRange(userData.organizationId, start, end)
            .then(res => setReservations(res as Reservation[]))
            .catch(err => console.error('Reservation fetch error:', err));
    }, [currentMonth, userData]);

    // URL 파라미터 처리 (날짜 선택)
    useEffect(() => {
        const dateParam = searchParams.get('date');
        if (dateParam) {
            setSelectedDate(dateParam);
            setCurrentMonth(new Date(dateParam));
        }
    }, [searchParams]);

    // 경로 정보 업데이트 (기관 주소 → 목적지 경로 탐색)
    useEffect(() => {
        if (!form.destination.trim() || !orgAddress || !isTmapAvailable()) {
            setRouteInfo(null);
            return;
        }

        // 선택된 차량의 carType 결정
        const selectedVehicle = vehicles.find(v => v.id === form.vehicleId);
        const carType = selectedVehicle?.vehicleType
            ? VEHICLE_TYPE_TO_CAR_TYPE[selectedVehicle.vehicleType] || '0'
            : '0';

        const timer = setTimeout(async () => {
            setRouteLoading(true);
            try {
                const result = await getMultiRouteWithFreeRoad(orgAddress, form.destination.trim(), { carType });
                if (result) {
                    setRouteInfo({
                        distance: result.distance,
                        duration: result.duration,
                        tollFee: result.tollFee,
                        freeRoadRoute: result.freeRoadRoute,
                    });
                    if (form.startTime && result.duration) {
                        const autoEnd = calcEndTime(form.startTime, result.duration);
                        setForm(prev => ({ ...prev, endTime: autoEnd }));
                    }
                } else {
                    setRouteInfo(null);
                }
            } catch {
                setRouteInfo(null);
            } finally {
                setRouteLoading(false);
            }
        }, 800);

        return () => clearTimeout(timer);
    }, [form.destination, form.startTime, form.vehicleId, orgAddress, vehicles]);

    // 달력 데이터 생성
    const calendarDays = useMemo(() => {
        const start = startOfMonth(currentMonth);
        const end = endOfMonth(currentMonth);
        const days = eachDayOfInterval({ start, end });

        const prefix = Array(start.getDay()).fill(null);

        return [...prefix, ...days.map(d => {
            const dStr = format(d, 'yyyy-MM-dd');
            return {
                date: d.getDate(),
                dateStr: dStr,
                reservations: reservations.filter(r => r.date === dStr && r.status !== 'cancelled'),
                holiday: holidays.find(h => h.date === dStr)?.name || null
            };
        })] as (CalendarDay | null)[];
    }, [currentMonth, reservations, holidays]);

    const monthLabel = format(currentMonth, 'yyyy년 M월');

    const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
    const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

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

    const isPastDate = isBefore(startOfDay(new Date(selectedDate)), startOfDay(new Date()));
    const isToday = selectedDate === todayStr;

    const selectedReservations = useMemo(() =>
        reservations.filter(r => r.date === selectedDate)
            .sort((a, b) => a.startTime.localeCompare(b.startTime)),
        [reservations, selectedDate]);

    // 현재 시간 문자열 (HH:mm)
    const getCurrentTimeStr = () => format(new Date(), 'HH:mm');

    // 최소 시작 시간 (오늘이면 현재 시간, 아니면 00:00)
    const getMinStartTime = () => isToday ? getCurrentTimeStr() : '00:00';




    // 예약 폼 열기 (기본 시간 자동 설정)
    const handleOpenForm = () => {
        if (showForm) {
            setShowForm(false);
            setEditingReservation(null);
            setForm({ vehicleId: '', destination: '', purpose: '', startTime: '', endTime: '', endDate: '' });
            setRouteInfo(null);
            setShowFavSave(false);
            setFavName('');
            return;
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

        // 과거 날짜는 폼을 열지 않음
        if (!form.startTime && !form.endTime) {
            setForm(prev => ({
                ...prev,
                startTime: isToday ? defaultStart : '09:00',
                endTime: isToday ? defaultEnd : '10:00',
            }));
        }
        setShowForm(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !userData?.organizationId) return;
        if (!form.vehicleId || !form.destination || !form.startTime || !form.endTime) {
            showToast('필수 정보를 입력해주세요.', 'warning');
            return;
        }

        // 다일 예약 여부 판단
        const effectiveEndDate = form.endDate || selectedDate;
        const isMultiDay = effectiveEndDate > selectedDate;

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
        if (userOverlap) {
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
                await deleteReservationGroup(editingGroupId);

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
                });
                showToast('예약이 완료되었습니다.');
            }
            // 목록 새로고침
            const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
            const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd');
            const res = await getReservationsByDateRange(userData.organizationId, start, end);
            setReservations(res as Reservation[]);

            setShowForm(false);
            setEditingReservation(null);
            setEditingGroupId(null);
            setForm({ vehicleId: '', destination: '', purpose: '', startTime: '', endTime: '', endDate: '' });
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
    };

    const handleEdit = (res: Reservation) => {
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
    };

    const handleCancel = async (id: string) => {
        // 연속 예약인지 확인
        const target = reservations.find(r => r.id === id);
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
                const cancelled = await cancelReservationGroup(groupId);
                showToast(`다일 예약 ${cancelled}건이 취소되었습니다.`);
                setReservations(prev => prev.map(r => r.groupId === groupId ? { ...r, status: 'cancelled' } : r));
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
            } catch (error: unknown) {
                const errMsg = error instanceof Error ? error.message : '취소에 실패했습니다.';
                showToast(errMsg, 'error');
            }
        }
    };

    const handleSaveFavorite = async () => {
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
    };

    const getNavigationDeeplink = (dest: string) => {
        // T-Map 또는 카카오맵 딥링크 (추후 구현)
        return `https://map.kakao.com/link/to/${dest}`;
    };

    return {
        vehicles, loading, form, setForm,
        selectedDate, showForm, setShowForm,
        sideTab, setSideTab,
        submitting, editingReservation, editingGroupId,
        favorites, routeInfo, routeLoading,
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
    };
}
