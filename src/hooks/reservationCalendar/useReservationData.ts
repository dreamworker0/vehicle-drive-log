import { useState, useEffect, useMemo } from 'react';
import {
    getVehicles,
    getReservationsByDateRange,
    getOrganizationMembers,
    getOrganization,
    getFavorites,
} from '../../lib/firestore';
import { getHolidays } from '../../lib/holiday';
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import type { Vehicle } from '../../types/vehicle';
import type { Reservation, CalendarDay } from '../../types/reservation';
import type { CustomHoliday } from '../../types/holiday';
import type { Favorite } from '../../types/favorite';
import type { User as UserDoc } from '../../types/user';

interface UseReservationDataParams {
    user: { uid: string } | null;
    userData: { organizationId?: string | null; name?: string } | null;
    isAdmin: boolean;
    showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
    currentMonth: Date;
}

export function useReservationData({
    user,
    userData,
    isAdmin,
    showToast,
    currentMonth,
}: UseReservationDataParams) {
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [loading, setLoading] = useState(true);
    const [favorites, setFavorites] = useState<Favorite[]>([]);
    const [holidays, setHolidays] = useState<CustomHoliday[]>([]);
    const [members, setMembers] = useState<UserDoc[]>([]);
    const [orgAddress, setOrgAddress] = useState('');

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

    return {
        vehicles,
        reservations,
        setReservations,
        loading,
        favorites,
        setFavorites,
        holidays,
        members,
        orgAddress,
        calendarDays,
    };
}
