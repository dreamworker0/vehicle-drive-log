/**
 * driveLogs/queries.ts
 * 운행일지 읽기(Read) 작업 — CQRS 읽기 측
 */
import {
    collection, query, where, getDocs,
    orderBy, limit,
    type QueryConstraint,
    type DocumentData,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type { DriveLog } from '../../../types/driveLog';
import { createZodConverter, driveLogSchema } from '../../../schemas';
import { captureError } from '../../sentry';
import { cachedQuery } from '../cache';

const driveLogConverter = createZodConverter(driveLogSchema);

// 운행일지 목록 조회 (커서 기반 페이지네이션 및 서버사이드 필터링 적용)
export const getDriveLogs = async (
    orgId: string, 
    filters: { limit?: number; startAfter?: unknown; since?: Date; vehicleId?: string; driverUid?: string; startDate?: string; endDate?: string } = {}
) => {
    try {
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

        const q = query(collection(db, 'driveLogs').withConverter(driveLogConverter), ...constraints);
        const snap = await getDocs(q);
        const docs = snap.docs.map(d => d.data());

        return {
            docs,
            lastDoc: snap.docs[snap.docs.length - 1] || null,
            hasMore: snap.docs.length === pageSize,
        };
    } catch (error) {
        captureError(error, { context: 'getDriveLogs', orgId, filters });
        throw error;
    }
};

// 내보내기 1회 호출당 안전 상한 — 초과 시 사용자에게 기간을 좁히도록 유도
export const EXPORT_MAX_DOCS = 5000;

/** 특정 기간/조건의 모든 운행일지를 엑셀/PDF 다운로드 용도로 한 번에 가져오기 */
export const getAllDriveLogsForExport = async (
    orgId: string,
    filters: { vehicleId?: string; driverUid?: string; startDate?: string; endDate?: string }
) => {
    if (!filters.startDate || !filters.endDate) {
        throw new Error('내보내기에는 시작일과 종료일이 필수입니다.');
    }
    try {
        const constraints: QueryConstraint[] = [];
        if (filters.driverUid) constraints.push(where('driverUid', '==', filters.driverUid));
        constraints.push(where('organizationId', '==', orgId));
        if (filters.vehicleId) constraints.push(where('vehicleId', '==', filters.vehicleId));

        constraints.push(where('timestamp', '>=', new Date(`${filters.startDate}T00:00:00`)));
        constraints.push(where('timestamp', '<=', new Date(`${filters.endDate}T23:59:59.999`)));

        constraints.push(orderBy('timestamp', 'desc'));
        constraints.push(limit(EXPORT_MAX_DOCS + 1));

        const q = query(collection(db, 'driveLogs').withConverter(driveLogConverter), ...constraints);
        const snap = await getDocs(q);
        if (snap.docs.length > EXPORT_MAX_DOCS) {
            throw new Error(`기간 내 운행일지가 ${EXPORT_MAX_DOCS}건을 초과합니다. 기간을 좁혀 다시 시도해 주세요.`);
        }
        return snap.docs.map(d => d.data());
    } catch (error) {
        captureError(error, { context: 'getAllDriveLogsForExport', orgId, filters });
        throw error;
    }
};

// 내 운행일지 목록 조회 (캐시 적용, TTL: 3분)
export const getMyDriveLogs = async (orgId: string, uid: string, limitCount = 30) => {
    const cacheKey = `driveLogs:my:${orgId}:${uid}:${limitCount}`;
    return cachedQuery(
        cacheKey,
        async () => {
            try {
                const q = query(
                    collection(db, 'driveLogs').withConverter(driveLogConverter),
                    where('organizationId', '==', orgId),
                    where('driverUid', '==', uid),
                    orderBy('timestamp', 'desc'),
                    limit(limitCount)
                );
                const snap = await getDocs(q);
                return snap.docs.map(d => d.data());
            } catch (error) {
                captureError(error, { context: 'getMyDriveLogs', orgId, uid });
                throw error;
            }
        },
        180_000 // 3분 캐시
    );
};

// 차량별 운행일지 조회 (기간 필터 + limit 기본 200) (캐시 적용, TTL: 3분)
export const getVehicleDriveLogs = async (orgId: string, vehicleId: string, since?: Date, limitCount = 200) => {
    const cacheKey = `driveLogs:vehicle:${orgId}:${vehicleId}:${since?.getTime() || 'all'}:${limitCount}`;
    return cachedQuery(
        cacheKey,
        async () => {
            try {
                const constraints: QueryConstraint[] = [
                    where('organizationId', '==', orgId),
                    where('vehicleId', '==', vehicleId),
                    orderBy('timestamp', 'desc'),
                    limit(limitCount),
                ];
                if (since) {
                    constraints.splice(2, 0, where('timestamp', '>=', since));
                }
                const q = query(collection(db, 'driveLogs').withConverter(driveLogConverter), ...constraints);
                const snap = await getDocs(q);
                return snap.docs.map(d => d.data());
            } catch (error) {
                captureError(error, { context: 'getVehicleDriveLogs', orgId, vehicleId });
                throw error;
            }
        },
        180_000 // 3분 캐시
    );
};

// 차량에 운행일지가 1건이라도 있는지 확인
export const hasVehicleDriveLogs = async (orgId: string, vehicleId: string): Promise<boolean> => {
    try {
        const q = query(
            collection(db, 'driveLogs'),
            where('organizationId', '==', orgId),
            where('vehicleId', '==', vehicleId),
            limit(1)
        );
        const snap = await getDocs(q);
        return !snap.empty;
    } catch (error) {
        captureError(error, { context: 'hasVehicleDriveLogs', orgId, vehicleId });
        throw error;
    }
};
