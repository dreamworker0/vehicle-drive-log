/**
 * useAdminBadges — 사이드바 배지 카운트 실시간 구독 훅
 * 차량(활성만), 직원, 하이패스 카드, 오늘 예약(취소 제외) 수를 반환한다.
 */
import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
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

        // 활성 차량 수 실시간 구독
        const vehicleQ = query(
            collection(db, 'vehicles'),
            where('organizationId', '==', orgId),
        );
        const unsubVehicles = onSnapshot(vehicleQ, (snap) => {
            const active = snap.docs.filter(d => !d.data().retired?.isRetired);
            setVehicleCount(active.length);
        }, () => setVehicleCount(null));

        // 직원 수 실시간 구독
        const employeeQ = query(
            collection(db, 'users'),
            where('organizationId', '==', orgId),
        );
        const unsubEmployees = onSnapshot(employeeQ, (snap) => {
            setEmployeeCount(snap.size);
        }, () => setEmployeeCount(null));

        // 하이패스 카드 수 실시간 구독
        const hipassQ = query(
            collection(db, 'hipassCards'),
            where('organizationId', '==', orgId),
        );
        const unsubHipass = onSnapshot(hipassQ, (snap) => {
            setHipassCount(snap.size);
        }, () => setHipassCount(null));

        // 오늘 예약 수 실시간 구독 (취소 제외)
        const today = new Date().toISOString().slice(0, 10);
        const reservationQ = query(
            collection(db, 'reservations'),
            where('organizationId', '==', orgId),
            where('date', '==', today),
        );
        const unsubReservations = onSnapshot(reservationQ, (snap) => {
            const active = snap.docs.filter(d => d.data().status !== 'cancelled');
            setReservationCount(active.length);
        }, () => setReservationCount(null));

        return () => {
            unsubVehicles();
            unsubEmployees();
            unsubHipass();
            unsubReservations();
        };
    }, [userData?.organizationId]);

    return { vehicleCount, employeeCount, hipassCount, reservationCount };
}
