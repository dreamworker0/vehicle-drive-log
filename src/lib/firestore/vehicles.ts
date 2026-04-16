import {
    doc, updateDoc, deleteDoc,
    collection, query, where, getDocs, addDoc,
    orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { cachedQuery, invalidateCache } from './cache';
import type { Vehicle } from '../../types/vehicle';
import { createZodConverter, vehicleSchema } from '../../schemas';
import { captureError } from '../sentry';

// 기관 소속 차량 목록 조회 (TTL 30초 캐시 적용)
export const getVehicles = async (orgId: string): Promise<Vehicle[]> => {
    return cachedQuery<Vehicle[]>(`vehicles:${orgId}`, async () => {
        const q = query(
            collection(db, 'vehicles').withConverter(createZodConverter(vehicleSchema)),
            where('organizationId', '==', orgId),
            orderBy('createdAt', 'desc')
        );
        const snap = await getDocs(q);
        // Converter를 통해 검증된 데이터를 바로 반환합니다.
        return snap.docs.map(d => d.data() as Vehicle); // Vehicle 타입과 Zod 스키마의 오차를 보정하기 위해 as Vehicle 하나는 허용하지만, 기존처럼 d.data()에 빈 매핑이 아닙니다. 엄격히는 d.data() 자체를 리턴.
    });
};

// 차량 등록
export const createVehicle = async (data: Record<string, unknown>) => {
    try {
        const docRef = await addDoc(collection(db, 'vehicles'), {
            ...data,
            currentKm: data.currentKm ?? 0,
            createdAt: serverTimestamp(),
        });
        invalidateCache('vehicles');
        return docRef.id;
    } catch (error) {
        captureError(error, { context: 'createVehicle', data });
        throw error;
    }
};

// 차량 정보 수정
export const updateVehicle = async (vehicleId: string, data: Record<string, unknown>) => {
    try {
        await updateDoc(doc(db, 'vehicles', vehicleId), data);
        invalidateCache('vehicles');
    } catch (error) {
        captureError(error, { context: 'updateVehicle', vehicleId, data });
        throw error;
    }
};

// 차량 삭제
export const deleteVehicle = async (vehicleId: string) => {
    try {
        await deleteDoc(doc(db, 'vehicles', vehicleId));
        invalidateCache('vehicles');
    } catch (error) {
        captureError(error, { context: 'deleteVehicle', vehicleId });
        throw error;
    }
};

// 차량 폐차(퇴역) 처리
export const retireVehicle = async (vehicleId: string, reason = '') => {
    try {
        await updateDoc(doc(db, 'vehicles', vehicleId), {
            retired: {
                isRetired: true,
                reason,
                retiredAt: serverTimestamp(),
            },
        });
        invalidateCache('vehicles');
    } catch (error) {
        captureError(error, { context: 'retireVehicle', vehicleId, reason });
        throw error;
    }
};

// 폐차 차량 복원
export const restoreVehicle = async (vehicleId: string) => {
    try {
        await updateDoc(doc(db, 'vehicles', vehicleId), {
            retired: null,
        });
        invalidateCache('vehicles');
    } catch (error) {
        captureError(error, { context: 'restoreVehicle', vehicleId });
        throw error;
    }
};
