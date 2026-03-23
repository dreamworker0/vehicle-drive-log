/**
 * Firestore — 차량 정비 (Maintenance) 관련 함수
 */
import {
    doc, getDoc, updateDoc, deleteDoc,
    collection, query, where, getDocs, addDoc,
    orderBy, limit, serverTimestamp,
    type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';

// 정비 기록 목록 조회
export const getMaintenanceRecords = async (orgId: string, vehicleId: string | null = null) => {
    let q;
    if (vehicleId) {
        q = query(
            collection(db, 'maintenanceRecords'),
            where('organizationId', '==', orgId),
            where('vehicleId', '==', vehicleId),
            orderBy('date', 'desc'),
            limit(100)
        );
    } else {
        q = query(
            collection(db, 'maintenanceRecords'),
            where('organizationId', '==', orgId),
            orderBy('date', 'desc'),
            limit(100)
        );
    }
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
};

// 정비 기록 생성 (차량 차단 플래그 지원)
export const createMaintenanceRecord = async (data: Record<string, unknown>) => {
    const { blockVehicle, blockEndDate, ...recordData } = data;
    const docRef = await addDoc(collection(db, 'maintenanceRecords'), {
        ...(recordData as Record<string, unknown>),
        blockVehicle: blockVehicle || false,
        blockEndDate: blockEndDate || null,
        createdAt: serverTimestamp(),
    });

    // 차량 차단 플래그가 켜져 있으면 차량 문서에 정비 차단 상태 기록
    if (blockVehicle && recordData.vehicleId) {
        await updateDoc(doc(db, 'vehicles', recordData.vehicleId as string), {
            maintenance: {
                isBlocked: true,
                reason: recordData.type,
                endDate: blockEndDate || null,
                recordId: docRef.id,
                blockedAt: serverTimestamp(),
            },
        });
    }

    return docRef;
};

// 정비 기록 삭제 (연결된 차량 차단도 해제)
export const deleteMaintenanceRecord = async (recordId: string, vehicleId: string | null = null) => {
    // 차량 차단과 연결된 기록이면 차단도 해제
    if (vehicleId) {
        const vehicleSnap = await getDoc(doc(db, 'vehicles', vehicleId));
        if (vehicleSnap.exists()) {
            const vehicle = vehicleSnap.data();
            if (vehicle.maintenance?.recordId === recordId) {
                await updateDoc(doc(db, 'vehicles', vehicleId), {
                    maintenance: null,
                });
            }
        }
    }
    await deleteDoc(doc(db, 'maintenanceRecords', recordId));
};

// 차량 정비 차단 수동 해제
export const clearVehicleMaintenanceBlock = async (vehicleId: string) => {
    await updateDoc(doc(db, 'vehicles', vehicleId), {
        maintenance: null,
    });
};

// 차량 정비 차단 시 기존 예약 일괄 취소 + 예약자 알림
export const cancelVehicleReservations = async (orgId: string, vehicleId: string, vehicleName: string, startDate: string, endDate: string | null, reason: string) => {
    const q = query(
        collection(db, 'reservations'),
        where('organizationId', '==', orgId),
        where('vehicleId', '==', vehicleId),
    );
    const snap = await getDocs(q);

    // 날짜 범위 + 활성 상태 필터링
    const targets = snap.docs
        .map(d => ({ id: d.id, ...d.data() }) as DocumentData & { id: string; status?: string; date?: string; reservedByUid?: string })
        .filter(r => r.status === 'reserved' && (r.date ?? '') >= startDate && (!endDate || (r.date ?? '') <= endDate));

    // 일괄 취소 + 예약자에게 알림 발송
    for (const res of targets) {
        await updateDoc(doc(db, 'reservations', res.id), { status: 'cancelled' });
        await addDoc(collection(db, 'notifications'), {
            targetUid: res.reservedByUid,
            title: '예약 자동 취소 안내',
            message: `${vehicleName} 차량이 정비(${reason})로 차단되어 ${res.date} 예약이 취소되었습니다`,
            type: 'reservation_cancelled_maintenance',
            read: false,
            createdAt: serverTimestamp(),
        });
    }
    return targets.length;
};
