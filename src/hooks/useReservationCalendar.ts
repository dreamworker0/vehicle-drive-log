import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    getVehicles,
    getReservationsByDateRange,
    createReservation,
    updateReservation,
    cancelReservation,
    getFavorites,
    createFavorite,
    getOrganizationMembers
} from '../lib/firestore';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { getHolidays } from '../lib/holiday';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isBefore, startOfDay } from 'date-fns';
import { getRouteInfo } from '../lib/tmap';
import { calcEndTime } from './utils/reservationUtils';
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
    reservedByUid?: string;
    reservedByName?: string;
}

export default function useReservationCalendar({ isAdmin = false } = {}) {
    const { user, userData } = useAuth();
    const [searchParams] = useSearchParams();
    const { showToast } = useToast();

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
    const [favorites, setFavorites] = useState<Favorite[]>([]);
    const [holidays, setHolidays] = useState<CustomHoliday[]>([]);
    const [members, setMembers] = useState<UserDoc[]>([]);

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
    const [routeInfo, setRouteInfo] = useState<{ distance: number; duration: number; tollFee?: number } | null>(null);
    const [routeLoading, setRouteLoading] = useState(false);

    const todayStr = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

    // 초기 데이터 로드
    useEffect(() => {
        if (!user || !userData?.organizationId) return;

        const fetchData = async () => {
            try {
                setLoading(true);
                const [vList, fList, hList] = await Promise.all([
                    getVehicles(userData.organizationId!),
                    getFavorites(user.uid),
                    getHolidays()
                ]);
                setVehicles(vList as Vehicle[]);
                setFavorites(fList as Favorite[]);
                setHolidays(hList as CustomHoliday[]);

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

    // 경로 정보 업데이트
    useEffect(() => {
        if (!form.destination.trim()) {
            setRouteInfo(null);
            return;
        }

        const timer = setTimeout(async () => {
            setRouteLoading(true);
            try {
                const info = await getRouteInfo(form.destination);
                setRouteInfo(info);
                // 경로 탐색 성공 시 자동 종료 시간 설정 (시작 시간이 있을 때만)
                if (form.startTime && info?.duration) {
                    const autoEnd = calcEndTime(form.startTime, info.duration);
                    setForm(prev => ({ ...prev, endTime: autoEnd }));
                }
            } catch {
                setRouteInfo(null);
            } finally {
                setRouteLoading(false);
            }
        }, 800);

        return () => clearTimeout(timer);
    }, [form.destination, form.startTime]);

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
                reservations: reservations.filter(r => r.date === dStr),
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
        setShowForm(false);
        setForm({
            vehicleId: '',
            destination: '',
            purpose: '',
            startTime: '',
            endTime: '',
        });
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !userData?.organizationId) return;
        if (!form.vehicleId || !form.destination || !form.startTime || !form.endTime) {
            showToast('필수 정보를 입력해주세요.', 'warning');
            return;
        }

        setSubmitting(true);
        try {
            if (editingReservation) {
                await updateReservation(editingReservation.id, {
                    ...form,
                    organizationId: userData.organizationId,
                });
                showToast('예약이 수정되었습니다.');
            } else {
                await createReservation({
                    ...form,
                    date: selectedDate,
                    reservedByUid: user.uid,
                    reservedByName: userData.name || user.email || '익명',
                    organizationId: userData.organizationId,
                    status: 'pending'
                } as unknown as Reservation);
                showToast('예약이 완료되었습니다.');
            }
            // 목록 새로고침
            const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
            const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd');
            const res = await getReservationsByDateRange(userData.organizationId, start, end);
            setReservations(res as Reservation[]);

            setShowForm(false);
            setEditingReservation(null);
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : '예약 처리에 실패했습니다.';
            showToast(errMsg, 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleEdit = (res: Reservation) => {
        setEditingReservation(res);
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
        if (!window.confirm('예약을 취소하시겠습니까?')) return;

        try {
            await cancelReservation(id);
            showToast('예약이 취소되었습니다.');
            setReservations(prev => prev.filter(r => r.id !== id));
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : '취소에 실패했습니다.';
            showToast(errMsg, 'error');
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
        submitting, editingReservation,
        favorites, routeInfo, routeLoading,
        showFavSave, setShowFavSave,
        favName, setFavName,
        calendarDays, monthLabel, todayStr,
        selectedReservations, isPastDate, isToday,
        user, members,
        prevMonth, nextMonth,
        handleDateSelect,
        handleSubmit, handleEdit, handleCancel, handleSaveFavorite,
        getCurrentTimeStr, getMinStartTime,
        getNavigationDeeplink,
    };
}
