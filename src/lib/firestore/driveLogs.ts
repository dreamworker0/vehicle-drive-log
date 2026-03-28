/**
 * Firestore — 운행일지 (Drive Logs) 관련 함수
 */
import {
    doc, updateDoc, deleteDoc,
    collection, query, where, getDocs, addDoc,
    orderBy, limit, serverTimestamp, getCountFromServer, Timestamp,
    type QueryConstraint,
    type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { DriveLog } from '../../types/driveLog';

/** 특정 시점 이후에 같은 차량의 운행기록이 존재하는지 확인 */
const hasLaterDriveLog = async (orgId: string, vehicleId: string, afterTimestamp: Date) => {
    const q = query(
        collection(db, 'driveLogs'),
        where('organizationId', '==', orgId),
        where('vehicleId', '==', vehicleId),
        where('timestamp', '>', afterTimestamp),
        limit(1)
    );
    const snap = await getDocs(q);
    return !snap.empty;
};

// 운행일지 생성 (중복 방지 체크 포함)
export const createDriveLog = async (data: Record<string, unknown>) => {
    // 중복 체크: 같은 기관+차량+운전자+startKm+endKm 이 같은 날짜에 이미 존재하면 거부
    if (data.organizationId && data.vehicleId && data.driverUid && data.startKm != null && data.endKm != null) {
        const logDate = data.timestamp instanceof Date ? data.timestamp : new Date();
        const dayStart = new Date(logDate.getFullYear(), logDate.getMonth(), logDate.getDate());
        const dayEnd = new Date(logDate.getFullYear(), logDate.getMonth(), logDate.getDate() + 1);

        const dupQuery = query(
            collection(db, 'driveLogs'),
            where('organizationId', '==', data.organizationId),
            where('vehicleId', '==', data.vehicleId),
            where('driverUid', '==', data.driverUid),
            where('timestamp', '>=', dayStart),
            where('timestamp', '<', dayEnd),
        );
        const dupSnap = await getDocs(dupQuery);
        const duplicate = dupSnap.docs.some(d => {
            const existing = d.data();
            return existing.startKm === data.startKm && existing.endKm === data.endKm;
        });
        if (duplicate) {
            throw new Error('동일한 운행 기록이 이미 존재합니다. 중복 저장을 방지했습니다.');
        }
    }

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    // Use a deterministic generated ID for offline idempotency
    const docRef = doc(collection(db, 'driveLogs'));
    const finalData = { ...data, createdAt: serverTimestamp() };
    const promise = addDoc(collection(db, 'driveLogs'), finalData);

    if (isOffline) {
        import('../offlineSync').then(({ queueOfflineAction }) => queueOfflineAction('CREATE_DRIVELOG', { ...data, id: docRef.id }));
    }
    await promise;

    // 차량의 누적 Km 갱신 — 이 기록 이후에 같은 차량의 기록이 없을 때만
    const isEffectivelyRetroactive = data.isRetroactive ||
        (data.organizationId && data.vehicleId && data.timestamp &&
            await hasLaterDriveLog(data.organizationId as string, data.vehicleId as string, data.timestamp as Date));
    if (data.endKm && data.vehicleId && !isEffectivelyRetroactive) {
        await updateDoc(doc(db, 'vehicles', data.vehicleId as string), {
            currentKm: data.endKm,
        });
    }

    // 다음 기록의 startKm 자동 연동 (소급이든 아니든 항상 시도)
    let syncResult: Awaited<ReturnType<typeof syncNextLogStartKm>> | null = null;
    if (data.endKm && data.vehicleId && data.organizationId && data.timestamp) {
        syncResult = await syncNextLogStartKm(data.organizationId as string, data.vehicleId as string, data.timestamp as Date, data.endKm as number);
    }

    return { id: docRef.id, syncResult };
};

/** 차량의 마지막 운행기록에서 endKm 조회 (currentKm과 비교하여 큰 값 반환) */
export const getLastVehicleEndKm = async (orgId: string, vehicleId: string) => {
    const q = query(
        collection(db, 'driveLogs'),
        where('organizationId', '==', orgId),
        where('vehicleId', '==', vehicleId),
        orderBy('timestamp', 'desc'),
        limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const lastLog = snap.docs[0].data();
    return lastLog.endKm || null;
};

/** 차량의 마지막 운행기록에서 도착 배터리(%) 조회 — 출발 배터리 힌트용 */
export const getLastVehicleEndBattery = async (orgId: string, vehicleId: string): Promise<number | null> => {
    const q = query(
        collection(db, 'driveLogs'),
        where('organizationId', '==', orgId),
        where('vehicleId', '==', vehicleId),
        orderBy('timestamp', 'desc'),
        limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const lastLog = snap.docs[0].data();
    return lastLog.batteryEnd ?? null;
};

/** 특정 날짜 이전의 가장 최근 운행기록에서 endKm 조회 (소급 입력용) */
export const getVehicleEndKmBefore = async (orgId: string, vehicleId: string, beforeDate: Date) => {
    const q = query(
        collection(db, 'driveLogs'),
        where('organizationId', '==', orgId),
        where('vehicleId', '==', vehicleId),
        where('timestamp', '<', beforeDate),
        orderBy('timestamp', 'desc'),
        limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return snap.docs[0].data().endKm || null;
};

/**
 * 소급 입력/수정 시 같은 차량의 이후 모든 운행기록 startKm을 연쇄적으로 자동 업데이트
 * - 직전 기록의 endKm → 다음 기록의 startKm 으로 순차 갱신
 * - 최대 20개까지 연쇄 업데이트 (무한 루프 방지)
 * @returns {{ updated: boolean, logId?: string, oldStartKm?: number, newStartKm?: number, chainCount?: number }}
 */
export const syncNextLogStartKm = async (orgId: string, vehicleId: string, afterDate: Date, newStartKm: number) => {
    let currentAfterDate = afterDate;
    let carryKm = newStartKm; // 다음 기록에 전달할 startKm
    let firstResult: { updated: boolean; logId?: string; oldStartKm?: number; newStartKm?: number } = { updated: false };
    let chainCount = 0;
    const MAX_CHAIN = 20;

    while (chainCount < MAX_CHAIN) {
        const q = query(
            collection(db, 'driveLogs'),
            where('organizationId', '==', orgId),
            where('vehicleId', '==', vehicleId),
            where('timestamp', '>', currentAfterDate),
            orderBy('timestamp', 'asc'),
            limit(1)
        );
        const snap = await getDocs(q);
        if (snap.empty) break;

        const nextDoc = snap.docs[0];
        const nextData = nextDoc.data();
        const oldStartKm = nextData.startKm;

        // startKm이 이미 맞으면 연쇄 중단 (이후 기록도 영향 없음)
        if (oldStartKm === carryKm) break;

        await updateDoc(doc(db, 'driveLogs', nextDoc.id), {
            startKm: carryKm,
            editedAt: serverTimestamp(),
        });

        if (chainCount === 0) {
            firstResult = { updated: true, logId: nextDoc.id, oldStartKm, newStartKm: carryKm };
        }

        // 다음 연쇄: 현재 기록의 endKm → 그 다음 기록의 startKm
        carryKm = nextData.endKm ?? carryKm;
        currentAfterDate = nextData.timestamp instanceof Date
            ? nextData.timestamp
            : (nextData.timestamp?.toDate ? nextData.timestamp.toDate() : new Date(nextData.timestamp));
        chainCount++;
    }

    return { ...firstResult, chainCount };
};

// 운행일지 목록 조회 (커서 기반 페이지네이션 및 서버사이드 필터링 적용)
export const getDriveLogs = async (
    orgId: string, 
    filters: { limit?: number; startAfter?: unknown; since?: Date; vehicleId?: string; driverUid?: string; startDate?: string; endDate?: string } = {}
) => {
    const pageSize = filters.limit || 50;
    const constraints: QueryConstraint[] = [];
    
    // 조건: 운전자가 지정된 경우
    if (filters.driverUid) {
        constraints.push(where('driverUid', '==', filters.driverUid));
    }
    
    // 조건: 소속
    constraints.push(where('organizationId', '==', orgId));

    // 조건: 차량
    if (filters.vehicleId) {
        constraints.push(where('vehicleId', '==', filters.vehicleId));
    }

    // 날짜 조건 (startDate, endDate 결합 => timestamp 범위)
    if (filters.startDate || filters.endDate || filters.since) {
        if (filters.since) {
            constraints.push(where('timestamp', '>=', filters.since));
        } else {
            if (filters.startDate) {
                constraints.push(where('timestamp', '>=', new Date(`${filters.startDate}T00:00:00`)));
            }
            if (filters.endDate) {
                constraints.push(where('timestamp', '<=', new Date(`${filters.endDate}T23:59:59.999`)));
            }
        }
    }

    // 정렬과 Limit
    constraints.push(orderBy('timestamp', 'desc'));
    constraints.push(limit(pageSize));

    // 커서
    if (filters.startAfter) {
        const { startAfter: startAfterFn } = await import('firebase/firestore');
        constraints.push(startAfterFn(filters.startAfter as DocumentData));
    }

    const q = query(collection(db, 'driveLogs'), ...constraints);
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }) as DriveLog);

    return {
        docs,
        lastDoc: snap.docs[snap.docs.length - 1] || null,
        hasMore: snap.docs.length === pageSize,
    };
};

/** 특정 기간/조건의 모든 운행일지를 엑셀/PDF 다운로드 용도로 한 번에 가져오기 */
export const getAllDriveLogsForExport = async (
    orgId: string,
    filters: { vehicleId?: string; driverUid?: string; startDate?: string; endDate?: string }
) => {
    const constraints: QueryConstraint[] = [];
    if (filters.driverUid) constraints.push(where('driverUid', '==', filters.driverUid));
    constraints.push(where('organizationId', '==', orgId));
    if (filters.vehicleId) constraints.push(where('vehicleId', '==', filters.vehicleId));
    
    if (filters.startDate) constraints.push(where('timestamp', '>=', new Date(`${filters.startDate}T00:00:00`)));
    if (filters.endDate) constraints.push(where('timestamp', '<=', new Date(`${filters.endDate}T23:59:59.999`)));
    
    constraints.push(orderBy('timestamp', 'desc'));

    const q = query(collection(db, 'driveLogs'), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as DriveLog);
};

/**
 * 대시보드 통계용: 서버 측 카운트 쿼리 수행
 */
export const getDriveLogCount = async (
    orgId: string, 
    period?: { startDate?: string; endDate?: string }
): Promise<number> => {
    const constraints: QueryConstraint[] = [where('organizationId', '==', orgId)];
    
    if (period?.startDate) {
        constraints.push(where('timestamp', '>=', new Date(`${period.startDate}T00:00:00`)));
    }
    if (period?.endDate) {
        constraints.push(where('timestamp', '<=', new Date(`${period.endDate}T23:59:59.999`)));
    }
    
    const q = query(collection(db, 'driveLogs'), ...constraints);
    const snapshot = await getCountFromServer(q);
    return snapshot.data().count;
};

// 내 운행일지 목록 조회
export const getMyDriveLogs = async (orgId: string, uid: string, limitCount = 30) => {
    const q = query(
        collection(db, 'driveLogs'),
        where('organizationId', '==', orgId),
        where('driverUid', '==', uid),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as DriveLog);
};

// 운행일지 수정
export const updateDriveLog = async (logId: string, data: Record<string, unknown>) => {
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    const finalData = { ...data, editedAt: serverTimestamp() };
    const promise = updateDoc(doc(db, 'driveLogs', logId), finalData);

    if (isOffline) {
        import('../offlineSync').then(({ queueOfflineAction }) => queueOfflineAction('UPDATE_DRIVELOG', { ...data, id: logId }));
    }
    await promise;
    // endKm이 변경되고 vehicleId가 있으면 차량 currentKm 갱신
    if (data.endKm && data.vehicleId) {
        await updateDoc(doc(db, 'vehicles', data.vehicleId as string), {
            currentKm: data.endKm,
        });
    }

    // endKm 변경 시 다음 기록의 startKm 자동 연동
    let syncResult: Awaited<ReturnType<typeof syncNextLogStartKm>> | null = null;
    if (data.endKm && data.vehicleId && data.organizationId && data.timestamp) {
        syncResult = await syncNextLogStartKm(data.organizationId as string, data.vehicleId as string, data.timestamp as Date, data.endKm as number);
    }
    return { syncResult };
};

// 차량별 운행일지 조회 (기간 필터 + limit 기본 200)
export const getVehicleDriveLogs = async (vehicleId: string, since?: Date, limitCount = 200) => {
    const constraints: QueryConstraint[] = [
        where('vehicleId', '==', vehicleId),
        orderBy('timestamp', 'desc'),
        limit(limitCount),
    ];
    if (since) {
        constraints.splice(1, 0, where('timestamp', '>=', since));
    }
    const q = query(collection(db, 'driveLogs'), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }) as DriveLog);
};

// 차량에 운행일지가 1건이라도 있는지 확인
export const hasVehicleDriveLogs = async (vehicleId: string): Promise<boolean> => {
    const q = query(
        collection(db, 'driveLogs'),
        where('vehicleId', '==', vehicleId),
        limit(1)
    );
    const snap = await getDocs(q);
    return !snap.empty;
};

// 운행일지 삭제
export const deleteDriveLog = async (logId: string) => {
    await deleteDoc(doc(db, 'driveLogs', logId));
};

// 운행일지 중복 정리 (Cloud Function 호출)
export const cleanupDuplicateLogs = async (organizationId: string, { dryRun = true } = {}) => {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const functions = getFunctions(undefined, 'asia-northeast3');
    const callable = httpsCallable(functions, 'cleanupDuplicateLogs', { timeout: 120000 });
    const result = await callable({ organizationId, dryRun });
    return result.data;
};
