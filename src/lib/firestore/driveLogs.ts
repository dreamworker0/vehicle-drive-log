/**
 * Firestore — 운행일지 (Drive Logs) 관련 함수
 */
import {
    doc, updateDoc, deleteDoc,
    collection, query, where, getDocs, addDoc,
    orderBy, limit, serverTimestamp,
    type QueryConstraint,
} from 'firebase/firestore';
import { db } from '../firebase';

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
export const createDriveLog = async (data: Record<string, any>) => {
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

    const docRef = await addDoc(collection(db, 'driveLogs'), {
        ...data,
        createdAt: serverTimestamp(),
    });

    // 차량의 누적 Km 갱신 — 이 기록 이후에 같은 차량의 기록이 없을 때만
    const isEffectivelyRetroactive = data.isRetroactive ||
        (data.organizationId && data.vehicleId && data.timestamp &&
            await hasLaterDriveLog(data.organizationId, data.vehicleId, data.timestamp));
    if (data.endKm && data.vehicleId && !isEffectivelyRetroactive) {
        await updateDoc(doc(db, 'vehicles', data.vehicleId), {
            currentKm: data.endKm,
        });
    }

    // 다음 기록의 startKm 자동 연동 (소급이든 아니든 항상 시도)
    let syncResult: Awaited<ReturnType<typeof syncNextLogStartKm>> | null = null;
    if (data.endKm && data.vehicleId && data.organizationId && data.timestamp) {
        syncResult = await syncNextLogStartKm(data.organizationId, data.vehicleId, data.timestamp, data.endKm);
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
 * 소급 입력/수정 시 같은 차량의 바로 다음 운행기록 startKm을 자동 업데이트
 * @returns {{ updated: boolean, logId?: string, oldStartKm?: number, newStartKm?: number }}
 */
export const syncNextLogStartKm = async (orgId: string, vehicleId: string, afterDate: Date, newStartKm: number) => {
    const q = query(
        collection(db, 'driveLogs'),
        where('organizationId', '==', orgId),
        where('vehicleId', '==', vehicleId),
        where('timestamp', '>', afterDate),
        orderBy('timestamp', 'asc'),
        limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return { updated: false };

    const nextDoc = snap.docs[0];
    const nextData = nextDoc.data();
    const oldStartKm = nextData.startKm;

    // 이미 같으면 스킵
    if (oldStartKm === newStartKm) return { updated: false };

    await updateDoc(doc(db, 'driveLogs', nextDoc.id), {
        startKm: newStartKm,
        editedAt: serverTimestamp(),
    });

    return { updated: true, logId: nextDoc.id, oldStartKm, newStartKm };
};

// 운행일지 목록 조회 (커서 기반 페이지네이션)
export const getDriveLogs = async (orgId: string, filters: { limit?: number; startAfter?: unknown; since?: Date } = {}) => {
    const pageSize = filters.limit || 50;
    const constraints: QueryConstraint[] = [
        where('organizationId', '==', orgId),
        orderBy('timestamp', 'desc'),
        limit(pageSize),
    ];

    // 기간 필터: since 이후 데이터만 조회 (서버 쿼리 레벨)
    if (filters.since) {
        constraints.splice(1, 0, where('timestamp', '>=', filters.since));
    }

    // 커서 기반 페이지네이션: 이전 마지막 문서 이후부터 조회
    if (filters.startAfter) {
        const { startAfter: startAfterFn } = await import('firebase/firestore');
        constraints.splice(filters.since ? 3 : 2, 0, startAfterFn(filters.startAfter as any));
    }

    const q = query(collection(db, 'driveLogs'), ...constraints);
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));

    return {
        docs,
        lastDoc: snap.docs[snap.docs.length - 1] || null,
        hasMore: snap.docs.length === pageSize,
    };
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
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
};

// 운행일지 수정
export const updateDriveLog = async (logId: string, data: Record<string, any>) => {
    await updateDoc(doc(db, 'driveLogs', logId), {
        ...data,
        editedAt: serverTimestamp(),
    });
    // endKm이 변경되고 vehicleId가 있으면 차량 currentKm 갱신
    if (data.endKm && data.vehicleId) {
        await updateDoc(doc(db, 'vehicles', data.vehicleId), {
            currentKm: data.endKm,
        });
    }

    // endKm 변경 시 다음 기록의 startKm 자동 연동
    let syncResult: Awaited<ReturnType<typeof syncNextLogStartKm>> | null = null;
    if (data.endKm && data.vehicleId && data.organizationId && data.timestamp) {
        syncResult = await syncNextLogStartKm(data.organizationId, data.vehicleId, data.timestamp, data.endKm);
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
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
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
