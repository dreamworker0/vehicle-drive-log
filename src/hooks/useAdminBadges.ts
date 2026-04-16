/**
 * useAdminBadges — 사이드바 배지 카운트 실시간 구독 훅
 * 차량(활성만), 직원, 하이패스 카드, 오늘 예약(취소 제외) 수를 반환한다.
 */
import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, getCountFromServer } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './useAuth';

interface AdminBadges {
    vehicleCount: number | null;
    employeeCount: number | null;
    hipassCount: number | null;
    reservationCount: number | null;
}

export default function useAdminBadges(): AdminBadges {
    const { userData } = useAuth();
    const [vehicleCount, setVehicleCount] = useState<number | null>(null);
    const [employeeCount, setEmployeeCount] = useState<number | null>(null);
    const [hipassCount, setHipassCount] = useState<number | null>(null);
    const [reservationCount, setReservationCount] = useState<number | null>(null);

    useEffect(() => {
        const orgId = userData?.organizationId;
        if (!orgId) return;

        let isMounted = true;

        const fetchCounts = async () => {
            try {
                // 활성 차량 수 
                const vehicleQ = query(
                    collection(db, 'vehicles'),
                    where('organizationId', '==', orgId) // retire 여부는 클라이언트 필터링
                );
                const vSnap = await getDocs(vehicleQ);
                const activeVehicles = vSnap.docs.filter(d => !d.data().retired?.isRetired);
                
                // 직원 수 (getCountFromServer로 최적화)
                const employeeQ = query(
                    collection(db, 'users'),
                    where('organizationId', '==', orgId)
                );
                const employeeSnap = await getCountFromServer(employeeQ);
                
                // 하이패스 카드 수 (getCountFromServer로 최적화)
                const hipassQ = query(
                    collection(db, 'hipassCards'),
                    where('organizationId', '==', orgId)
                );
                const hipassSnap = await getCountFromServer(hipassQ);
                
                // 오늘 예약 수 
                const today = new Date().toISOString().slice(0, 10);
                const reservationQ = query(
                    collection(db, 'reservations'),
                    where('organizationId', '==', orgId),
                    where('date', '==', today)
                );
                const rSnap = await getDocs(reservationQ);
                const activeReservations = rSnap.docs.filter(d => d.data().status !== 'cancelled');

                if (isMounted) {
                    setVehicleCount(activeVehicles.length);
                    setEmployeeCount(employeeSnap.data().count);
                    setHipassCount(hipassSnap.data().count);
                    setReservationCount(activeReservations.length);
                }
            } catch (err) {
                console.error("Failed to fetch admin badges:", err);
                if (isMounted) {
                    setVehicleCount(null);
                    setEmployeeCount(null);
                    setHipassCount(null);
                    setReservationCount(null);
                }
            }
        };

        fetchCounts();

        // 선택적: 백그라운드 5분 단위 폴링 (원치 않으면 주석 처리가 가능하며, 가장 비용이 적습니다)
        // 현재는 첫 마운트(화면 로드) 시에만 불러오는 가장 경제적인 방식(1번 옵션)을 구현합니다.

        return () => {
            isMounted = false;
        };
    }, [userData?.organizationId]);

    return { vehicleCount, employeeCount, hipassCount, reservationCount };
}
