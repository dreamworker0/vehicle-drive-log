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

// 기관 소속 차량 목록 조회 (TTL 5분 캐시 — 차량은 거의 변하지 않고, 클라이언트발 변경은
// create/update/delete/retire/restore가 모두 invalidateCache('vehicles')로 즉시 무효화한다.
// 15곳 이상에서 독립 호출되므로 짧은 TTL은 화면 전환마다 재조회로 이어진다.)
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
    }, 300_000);
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
        // 폐차 사유는 관리자가 직접 쓰는 자유 입력이라 원문을 보고에 싣지 않는다
        // (사고 경위·연락처가 들어온다). 입력이 비어서 실패한 건지만 구분하면 충분하다.
        captureError(error, { context: 'retireVehicle', vehicleId, reasonLength: reason.length });
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
