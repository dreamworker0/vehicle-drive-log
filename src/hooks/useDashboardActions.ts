/**
 * useDashboardActions — TodayDashboard의 Mutation 핸들러들
 * useTodayDashboard에서 IO 핸들러(운행시작, 예약취소, 내비게이션)를 분리
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from './useToast';
import { updateReservationStatus, cancelReservation } from '../lib/firestore';
import { invalidateDashboardCache } from './useTodayDashboard';
import { isStaleChunkError, STALE_CHUNK_MESSAGE } from '../lib/staleChunk';
import type { Vehicle } from '../types/vehicle';
import type { Reservation } from '../types/reservation';

/** 운행 중 알림 표시용 */
const showDrivingNotification = async (reservation: Reservation) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
        const reg = await navigator.serviceWorker?.ready;
        reg?.showNotification('🚗 운행 중', {
            body: `${reservation.vehicleName || '차량'} 운행 중${reservation.destination ? ' · ' + reservation.destination : ''} — 탭하여 운행일지 작성`,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: `driving-${reservation.id}`,
            data: { click_action: `${window.location.origin}/employee/drive-log?reservationId=${reservation.id}` },
            requireInteraction: true,
        } as NotificationOptions);
    } catch { /* 알림 실패 무시 */ }
};

/** 운행 완료/취소 시 알림 제거 */
const clearDrivingNotification = async (resId?: string) => {
    if (!resId || !('Notification' in window)) return;
    try {
        const reg = await navigator.serviceWorker?.ready;
        if (!reg) return;
        const notifications = await reg.getNotifications({ tag: `driving-${resId}` });
        notifications.forEach(n => n.close());
    } catch {
        // 무시
    }
};

interface UseDashboardActionsParams {
    vehicles: Vehicle[];
    firstVehicleId?: string;
    setLocalStartedIds: React.Dispatch<React.SetStateAction<Map<string, string>>>;
    setLocalCancelledIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export default function useDashboardActions({
    vehicles,
    firstVehicleId,
    setLocalStartedIds,
    setLocalCancelledIds,
}: UseDashboardActionsParams) {
    const navigate = useNavigate();
    const { showToast } = useToast();
    const [startingId, setStartingId] = useState<string | null>(null);
    const [cancellingId, setCancellingId] = useState<string | null>(null);

    const handleStartDrive = async (reservation: Reservation) => {
        setStartingId(reservation.id);
        try {
            const now = new Date();
            const actualStartTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            await updateReservationStatus(reservation.id, 'in_progress', { actualStartTime });
            
            setLocalStartedIds(prev => new Map(prev).set(reservation.id, actualStartTime));
            invalidateDashboardCache();
            showDrivingNotification(reservation);
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
            
            setLocalStartedIds(prev => new Map(prev).set(reservation.id, actualStartTime));
            invalidateDashboardCache();
            showDrivingNotification(reservation);
        } catch (err) {
            console.error('운행 시작 실패:', err);
            showToast('운행 시작에 실패했습니다.', 'error');
            setStartingId(null);
            return;
        }

        // 길안내는 운행 시작과 분리한다. 예전에는 한 try 안에 있어, 상태를 in_progress로 바꾼 **뒤**
        // tmap 모듈 로드(배포 직후 구버전 탭)나 지오코딩이 실패하면 "운행 시작에 실패했습니다"가 떴다 —
        // 실제로는 운행이 이미 시작된 상태였다(2026-10-14 감사).
        try {
            const destination = reservation.destination || '';
            const navUrl = await (await import('../lib/tmap')).getNavigationDeeplink(app, destination);
            window.location.href = navUrl;
        } catch (err) {
            console.error('길안내 열기 실패:', err);
            if (isStaleChunkError(err)) {
                // 토스트 스토어가 이 문구와 정확히 같을 때만 [새로고침] 버튼을 붙인다(useToastStore)
                showToast(STALE_CHUNK_MESSAGE, 'warning');
            } else {
                showToast('운행은 시작되었어요. 길안내 앱을 열지 못했으니 직접 열어 주세요.', 'error');
            }
        } finally {
            setStartingId(null);
        }
    };

    /** 통합 예약 취소 (오늘/이번주 동일 로직) */
    const handleCancelReservation = async (reservation: Reservation) => {
        setCancellingId(reservation.id);
        try {
            await cancelReservation(reservation.id);
            setLocalCancelledIds(prev => new Set(prev).add(reservation.id));
            invalidateDashboardCache();
            await clearDrivingNotification(reservation.id);
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
                // 예약·바로 운행에서 미리 적어 둔 동승자를 운행일지 초기값으로 넘긴다.
                // 넘기지 않으면 출발할 때 고른 동승자가 도착 화면에서 사라진다.
                passengerUids: res.passengerUids,
                passengerNames: res.passengerNames,
                passengerCount: res.passengerCount,
                isQuickDrive: res.isQuickDrive,
            },
        });
    };

    const navigateToReservations = () => {
        navigate('/employee/reservations', { state: { openForm: true, defaultVehicleId: firstVehicleId } });
    };

    const navigateToQuickDrive = () => {
        navigate('/employee/quick-drive', {
            state: {
                recommendedVehicleId: firstVehicleId || null,
            },
        });
    };

    return {
        startingId,
        cancellingId,
        handleStartDrive,
        handleStartNavigation,
        handleCancelReservation,
        navigateToArrival,
        navigateToReservations,
        navigateToQuickDrive,
    };
}
