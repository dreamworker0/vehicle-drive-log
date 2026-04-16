/**
 * Firestore — 일별일지 조회 쿼리 함수
 * 특정 날짜+차량 기준으로 운행일지/주유일지 데이터를 조회
 */
import {
    collection, query, where, getDocs, orderBy, limit,
} from 'firebase/firestore';
import { db } from '../firebase';
import { createZodConverter, driveLogSchema } from '../../schemas';
import type { DriveLog } from '../../types/driveLog';
import type { FuelLog } from '../../types/fuelLog';

/**
 * 특정 날짜 + 차량의 운행일지 조회
 * @param orgId 기관 ID
 * @param vehicleId 차량 ID
 * @param dateStr 날짜 문자열 'YYYY-MM-DD'
 */
export const getDriveLogsByDate = async (orgId: string, vehicleId: string, dateStr: string) => {
    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999`);

    const q = query(
        collection(db, 'driveLogs').withConverter(createZodConverter(driveLogSchema)),
        where('organizationId', '==', orgId),
        where('vehicleId', '==', vehicleId),
        where('timestamp', '>=', dayStart),
        where('timestamp', '<=', dayEnd),
        orderBy('timestamp', 'asc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as DriveLog);
};

/**
 * 특정 날짜 + 차량의 주유일지 조회
 * @param orgId 기관 ID
 * @param vehicleId 차량 ID
 * @param dateStr 날짜 문자열 'YYYY-MM-DD'
 */
export const getFuelLogsByDate = async (orgId: string, vehicleId: string, dateStr: string) => {
    const q = query(
        collection(db, 'fuelLogs'),
        where('organizationId', '==', orgId),
        where('vehicleId', '==', vehicleId),
        where('date', '==', dateStr),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...(d.data() as FuelLog), id: d.id }));
};

/**
 * 전일 누계 계산: 해당 날짜 이전의 마지막 endKm 조회
 * @param orgId 기관 ID
 * @param vehicleId 차량 ID
 * @param dateStr 날짜 문자열 'YYYY-MM-DD'
 */
export const getPreviousDayEndKm = async (orgId: string, vehicleId: string, dateStr: string): Promise<number | null> => {
    const dayStart = new Date(`${dateStr}T00:00:00`);

    const q = query(
        collection(db, 'driveLogs'),
        where('organizationId', '==', orgId),
        where('vehicleId', '==', vehicleId),
        where('timestamp', '<', dayStart),
        orderBy('timestamp', 'desc'),
        limit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return snap.docs[0].data().endKm || null;
};
