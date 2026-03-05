/**
 * Firestore — 차량 (Vehicles) 관련 함수
 */
import {
    doc, updateDoc, deleteDoc,
    collection, query, where, getDocs, addDoc,
    orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

// 기관 소속 차량 목록 조회
export const getVehicles = async (orgId) => {
    const q = query(
        collection(db, 'vehicles'),
        where('organizationId', '==', orgId),
        orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

// 차량 등록
export const createVehicle = async (data) => {
    const docRef = await addDoc(collection(db, 'vehicles'), {
        ...data,
        currentKm: data.currentKm ?? 0,
        createdAt: serverTimestamp(),
    });
    return docRef.id;
};

// 차량 정보 수정
export const updateVehicle = async (vehicleId, data) => {
    await updateDoc(doc(db, 'vehicles', vehicleId), data);
};

// 차량 삭제
export const deleteVehicle = async (vehicleId) => {
    await deleteDoc(doc(db, 'vehicles', vehicleId));
};

// 차량 폐차(퇴역) 처리
export const retireVehicle = async (vehicleId, reason = '') => {
    await updateDoc(doc(db, 'vehicles', vehicleId), {
        retired: {
            isRetired: true,
            reason,
            retiredAt: serverTimestamp(),
        },
    });
};

// 폐차 차량 복원
export const restoreVehicle = async (vehicleId) => {
    await updateDoc(doc(db, 'vehicles', vehicleId), {
        retired: null,
    });
};
