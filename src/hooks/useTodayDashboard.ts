/**
 * useTodayDashboard — 오늘의 운행 대시보드 상태 + 로직
 * TodayDashboard에서 추출된 커스텀 훅
 */
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useToast } from './useToast';
import { getVehicles, getTodayReservations, getWeekReservations, updateReservationStatus, cancelReservation, getMyDriveLogs } from '../lib/firestore';
import { toLocalDateStr } from '../lib/dateUtils';
import type { Vehicle } from '../types/vehicle';
import type { Reservation } from '../types/reservation';

export default function useTodayDashboard() {
    const { user, userData } = useAuth();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [todayReservations, setTodayReservations] = useState<Reservation[]>([]);
    const [weekReservations, setWeekReservations] = useState<Reservation[]>([]);
    const [loading, setLoading] = useState(true);
    const [startingId, setStartingId] = useState<string | null>(null);
    const [cancellingId, setCancellingId] = useState<string | null>(null);
    const [incompleteAlerts, setIncompleteAlerts] = useState<(Reservation & { type: string })[]>([]);

    const orgId = userData?.organizationId;
    const todayStr = toLocalDateStr();

    const weekEndDate = useMemo(() => {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        return toLocalDateStr(d);
    }, []);

    useEffect(() => {
        if (!orgId) {
            setLoading(false);
            return;
        }
        const fetch = async () => {
            try {
                const [v, r, wr, myLogs] = await Promise.all([
                    getVehicles(orgId),
                    getTodayReservations(orgId, todayStr),
                    getWeekReservations(orgId, todayStr, weekEndDate),
                    getMyDriveLogs(orgId, user?.uid ?? '', 50),
                ]);
                setVehicles(v as Vehicle[]);
                setTodayReservations(r as Reservation[]);
                setWeekReservations(wr as Reservation[]);

                // 미작성 알림: 어제까지 in_progress/completed인데 일지 미연결 예약
                const logReservationIds = new Set(myLogs.filter(l => l.reservationId).map(l => l.reservationId));
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = toLocalDateStr(yesterday);

                const incomplete = wr
                    .filter(res => res.reservedByUid === user?.uid
                        && (res.status === 'in_progress' || res.status === 'completed')
                        && res.date <= yesterdayStr
                        && !logReservationIds.has(res.id)
                    );

                setIncompleteAlerts(
                    incomplete.map(res => ({ type: 'reservation' as const, ...res })) as (Reservation & { type: string })[]
                );
            } catch (err) {
                console.error('로드 실패:', err);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [orgId, todayStr, weekEndDate, user?.uid]);

    const myReservations = useMemo(() =>
        todayReservations
            .filter(r => r.reservedByUid === user?.uid && r.status !== 'completed')
            .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')),
        [todayReservations, user?.uid]
    );

    const weekGrouped = useMemo(() => {
        const myWeek = weekReservations
            .filter(r => r.reservedByUid === user?.uid && r.date !== todayStr && r.status !== 'completed')
            .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
        const grouped: Record<string, Reservation[]> = {};
        myWeek.forEach(r => {
            if (!grouped[r.date]) grouped[r.date] = [];
            grouped[r.date].push(r);
        });
        return grouped;
    }, [weekReservations, user?.uid, todayStr]);

    // 30분 이내 임박 예약 감지
    const upcomingAlerts = useMemo(() => {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        return myReservations.filter(r => {
            if (r.status !== 'reserved' || !r.startTime) return false;
            const [h, m] = r.startTime.split(':').map(Number);
            const startMin = h * 60 + m;
            const diff = startMin - nowMin;
            return diff > 0 && diff <= 30;
        });
    }, [myReservations]);

    // 현재 운행 중인 예약이 있는지 여부 (동시 운행 시작 방지)
    const hasActiveDrive = useMemo(() =>
        myReservations.some(r => r.status === 'in_progress'),
        [myReservations]
    );

    // 추천 차량: 2시간 이내 예약이 없고 다음 예약까지 가장 여유 있는 차량
    const recommendedVehicle = useMemo(() => {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const twoHoursLater = nowMin + 120;

        const candidates = vehicles.filter(v => !v.maintenance?.isBlocked && !v.retired?.isRetired).map(v => {
            // 해당 차량의 오늘 예약 중 취소/완료 아닌 것
            const vReservations = todayReservations
                .filter(r => r.vehicleId === v.id && r.status !== 'completed' && r.status !== 'cancelled')
                .map(r => {
                    const [sh, sm] = (r.startTime || '00:00').split(':').map(Number);
                    const [eh, em] = (r.endTime || '23:59').split(':').map(Number);
                    return { startMin: sh * 60 + sm, endMin: eh * 60 + em };
                })
                .sort((a, b) => a.startMin - b.startMin);

            // 현재 진행 중이거나 2시간 이내 시작 예약이 있으면 제외
            const hasNearReservation = vReservations.some(r =>
                r.startMin <= twoHoursLater && r.endMin > nowMin
            );
            if (hasNearReservation) return null;

            // 다음 예약까지 남은 시간(분)
            const nextReservation = vReservations.find(r => r.startMin > nowMin);
            const minutesUntilNext = nextReservation
                ? nextReservation.startMin - nowMin
                : Infinity;

            return { ...v, minutesUntilNext };
        }).filter(Boolean);

        if (candidates.length === 0) return null;
        return candidates.sort((a, b) => (b?.minutesUntilNext ?? 0) - (a?.minutesUntilNext ?? 0))[0];
    }, [vehicles, todayReservations]);

    const handleStartDrive = async (reservation: Reservation) => {
        setStartingId(reservation.id);
        try {
            const now = new Date();
            const actualStartTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            await updateReservationStatus(reservation.id, 'in_progress', { actualStartTime });
            setTodayReservations(prev => prev.map(r =>
                r.id === reservation.id ? { ...r, status: 'in_progress', actualStartTime } : r
            ));
        } catch (err) {
            console.error('운행 시작 실패:', err);
            showToast('운행 시작에 실패했습니다.', 'error');
        } finally {
            setStartingId(null);
        }
    };

    const handleStartNavigation = async (reservation: Reservation, app = 'tmap') => {
        setStartingId(reservation.id);
        try {
            const now = new Date();
            const actualStartTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            await updateReservationStatus(reservation.id, 'in_progress', { actualStartTime });
            setTodayReservations(prev => prev.map(r =>
                r.id === reservation.id ? { ...r, status: 'in_progress', actualStartTime } : r
            ));
            const destination = reservation.destination || '';
            const navUrl = await (await import('../lib/tmap')).getNavigationDeeplink(app, destination);
            window.location.href = navUrl;
        } catch (err) {
            console.error('운행 시작 실패:', err);
            showToast('운행 시작에 실패했습니다.', 'error');
        } finally {
            setStartingId(null);
        }
    };

    const handleCancelWeekReservation = async (reservation: Reservation) => {
        if (!confirm(`${reservation.vehicleName} 예약을 취소하시겠습니까?`)) return;
        setCancellingId(reservation.id);
        try {
            await cancelReservation(reservation.id);
            setWeekReservations(prev => prev.filter(r => r.id !== reservation.id));
        } catch (err) {
            console.error('예약 취소 실패:', err);
            showToast('예약 취소에 실패했습니다.', 'error');
        } finally {
            setCancellingId(null);
        }
    };

    const navigateToArrival = (res: Reservation) => {
        const vehicle = vehicles.find(v => v.id === res.vehicleId);
        navigate('/employee/drive-log', {
            state: {
                reservationId: res.id,
                vehicleId: res.vehicleId,
                vehicleName: res.vehicleName,
                purpose: res.purpose || '',
                destination: res.destination || '',
                currentKm: vehicle?.currentKm || 0,
                vehicleType: vehicle?.vehicleType || '',
                fuelType: vehicle?.fuelType || '',
                actualStartTime: res.actualStartTime || '',
            },
        });
    };

    const navigateToReservations = () => {
        navigate('/employee/reservations', { state: { openForm: true } });
    };

    const navigateToQuickDrive = () => {
        navigate('/employee/quick-drive', {
            state: {
                recommendedVehicleId: recommendedVehicle?.id || null,
            },
        });
    };

    const todayLabel = new Date().toLocaleDateString('ko-KR', {
        month: 'long', day: 'numeric', weekday: 'long',
    });

    return {
        vehicles, loading, startingId, cancellingId,
        myReservations, weekGrouped, todayLabel,
        upcomingAlerts, incompleteAlerts, hasActiveDrive,
        handleStartDrive, handleStartNavigation,
        handleCancelWeekReservation,
        navigateToArrival, navigateToReservations, navigateToQuickDrive,
        recommendedVehicle,
    };
}
