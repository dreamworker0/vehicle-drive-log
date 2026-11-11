/**
 * Firestore — 차량 정비 (Maintenance) 관련 함수
 */
import {
    doc, getDoc, updateDoc, deleteDoc,
    collection, query, where, getDocs, addDoc,
    orderBy, limit, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { captureError } from '../sentry';
import { createZodConverter, maintenanceSchema } from '../../schemas';
import { invalidateCache } from './cache';
import { reservationActorStamp } from './actorStamp';

// 읽기 경로에 스키마 검증을 건다 (원시 캐스팅 대체 — fuelLogs와 동일한 이유).
const maintenanceRef = () => collection(db, 'maintenanceRecords').withConverter(createZodConverter(maintenanceSchema));

// 정비 기록 목록 조회
export const getMaintenanceRecords = async (orgId: string, vehicleId: string | null = null) => {
    let q;
    if (vehicleId) {
        q = query(
            maintenanceRef(),
            where('organizationId', '==', orgId),
            where('vehicleId', '==', vehicleId),
            orderBy('date', 'desc'),
            limit(100)
        );
    } else {
        q = query(
            maintenanceRef(),
            where('organizationId', '==', orgId),
            orderBy('date', 'desc'),
            limit(100)
        );
    }
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data(), id: d.id }));
};

// 정비 기록 생성 (차량 차단 플래그 지원)
export const createMaintenanceRecord = async (data: Record<string, unknown>) => {
    try {
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
            invalidateCache('vehicles'); // 차단 상태가 5분 TTL 캐시에 남지 않도록 즉시 무효화
        }

        return docRef;
    } catch (error) {
        captureError(error as Error, { context: 'createMaintenanceRecord', data });
        throw error;
    }
};

// 정비 기록 수정
export const updateMaintenanceRecord = async (recordId: string, data: Record<string, unknown>) => {
    try {
        const { blockVehicle, blockEndDate, ...recordData } = data;
        await updateDoc(doc(db, 'maintenanceRecords', recordId), {
            ...(recordData as Record<string, unknown>),
            blockVehicle: blockVehicle || false,
            blockEndDate: blockEndDate || null,
            updatedAt: serverTimestamp(),
        });

        // 차량 차단 플래그 동기화
        if (recordData.vehicleId) {
            if (blockVehicle) {
                await updateDoc(doc(db, 'vehicles', recordData.vehicleId as string), {
                    maintenance: {
                        isBlocked: true,
                        reason: recordData.type,
                        endDate: blockEndDate || null,
                        recordId: recordId,
                        blockedAt: serverTimestamp(),
                    },
                });
            } else {
                // 만약 해당 블록 레코드로 잠겨있었는데 이제 해제되었다면
                const vehicleSnap = await getDoc(doc(db, 'vehicles', recordData.vehicleId as string));
                if (vehicleSnap.exists()) {
                    const vehicle = vehicleSnap.data();
                    if (vehicle.maintenance?.recordId === recordId) {
                        await updateDoc(doc(db, 'vehicles', recordData.vehicleId as string), {
                            maintenance: null,
                        });
                    }
                }
            }
            invalidateCache('vehicles'); // 차단 상태 변경이 5분 TTL 캐시에 남지 않도록 즉시 무효화
        }
    } catch (error) {
        captureError(error as Error, { context: 'updateMaintenanceRecord', recordId, data });
        throw error;
    }
};

// 정비 기록 삭제 (연결된 차량 차단도 해제)
export const deleteMaintenanceRecord = async (recordId: string, vehicleId: string | null = null) => {
    try {
        // 차량 차단과 연결된 기록이면 차단도 해제
        if (vehicleId) {
            const vehicleSnap = await getDoc(doc(db, 'vehicles', vehicleId));
            if (vehicleSnap.exists()) {
                const vehicle = vehicleSnap.data();
                if (vehicle.maintenance?.recordId === recordId) {
                    await updateDoc(doc(db, 'vehicles', vehicleId), {
                        maintenance: null,
                    });
                    invalidateCache('vehicles');
                }
            }
        }
        await deleteDoc(doc(db, 'maintenanceRecords', recordId));
    } catch (error) {
        captureError(error as Error, { context: 'deleteMaintenanceRecord', recordId, vehicleId });
        throw error;
    }
};

// 차량 정비 차단 수동 해제
export const clearVehicleMaintenanceBlock = async (vehicleId: string) => {
    try {
        await updateDoc(doc(db, 'vehicles', vehicleId), {
            maintenance: null,
        });
        invalidateCache('vehicles');
    } catch (error) {
        captureError(error as Error, { context: 'clearVehicleMaintenanceBlock', vehicleId });
        throw error;
    }
};

/** Firestore 쓰기 묶음(writeBatch) 한 번의 최대 쓰기 수 */
const BATCH_LIMIT = 500;

/**
 * 차량 정비 차단·폐차 시 기존 예약 일괄 취소
 *
 * 예약자 알림은 취소 트리거(onReservationUpdated)가 보낸다 — `cancelReason`을 함께 남기면 알림에 사유가
 * 붙는다. 예전에는 여기서 notifications 문서를 직접 만들었는데, Rules가 클라이언트 생성을 superAdmin에게만
 * 열어 두어 **기관 관리자가 실행하면 첫 예약만 취소되고 permission-denied로 멈췄다**(나머지 예약은 그대로).
 *
 * 승인 대기(pending) 예약도 함께 취소한다. 남겨 두면 막힌 차량의 예약이 승인 목록에 계속 남는다.
 *
 * 인덱스: `reservations (organizationId, vehicleId, status, date)`가 필요하다 (status는 `in`이어도 같은 인덱스).
 * 동등 필터 3개 뒤에 `date` 범위가 붙어 단일 필드 인덱스 병합으로는 처리되지 않는다.
 * 인덱스가 없으면 조회가 통째로 실패해 **정비 기록은 저장됐는데 예약은 그대로 남고**
 * 화면에는 "저장에 실패했습니다"만 뜬다 (Sentry JAVASCRIPT-REACT-5F, 2026-08-26).
 *
 * 한 번의 쓰기 묶음(writeBatch)으로 취소하고 처리 번호(`editBatchId`)를 함께 남긴다. 트리거는 그 번호로
 * 예약자별로 묶어 **한 번만** 요약 알림을 보낸다(묶음이 한꺼번에 커밋되어야 요약 건수가 맞다).
 *
 * @param _vehicleName 쓰지 않는다 — 알림의 차량 이름은 트리거가 예약 문서에서 붙인다(호출부 호환용으로 남김).
 * @param reason 예약자에게 보일 취소 사유 문구 (예: `정비(엔진오일)로 차량 사용 차단`, `폐차 (매각)`)
 */
export const cancelVehicleReservations = async (orgId: string, vehicleId: string, _vehicleName: string, startDate: string, endDate: string | null, reason: string) => {
    try {
        const constraints = [
            where('organizationId', '==', orgId),
            where('vehicleId', '==', vehicleId),
            where('status', 'in', ['pending', 'reserved']),
            where('date', '>=', startDate),
        ];
        if (endDate) {
            constraints.push(where('date', '<=', endDate));
        }
        const q = query(
            collection(db, 'reservations'),
            ...constraints,
        );
        const snap = await getDocs(q);

        // 일괄 취소 — 문서마다 새 스탬프를 찍어야 트리거가 "다른 사람이 취소했다"고 보고 예약자에게 알린다.
        // 한 묶음 쓰기 한도(500건)를 넘는 일은 사실상 없지만, 넘으면 나눠 커밋한다(그때는 요약이 묶음별로 나뉜다).
        const editBatchId = crypto.randomUUID();
        for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
            const batch = writeBatch(db);
            for (const d of snap.docs.slice(i, i + BATCH_LIMIT)) {
                batch.update(doc(db, 'reservations', d.id), {
                    status: 'cancelled', cancelReason: reason, editBatchId, ...reservationActorStamp(),
                });
            }
            await batch.commit();
        }
        return snap.size;
    } catch (error) {
        captureError(error as Error, { context: 'cancelVehicleReservations', orgId, vehicleId, startDate, endDate });
        throw error;
    }
};
