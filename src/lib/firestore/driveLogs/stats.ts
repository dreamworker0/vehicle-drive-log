/**
 * driveLogs/stats.ts
 * 운행일지 통계 함수 — 대시보드·집계용
 */
import {
    doc, getDoc,
    collection, query, where,
    getCountFromServer,
    type QueryConstraint,
} from 'firebase/firestore';
import { db } from '../../firebase';

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

// 기관별 집계 통계 가져오기
export interface AggregatedStats {
    totalDistance: number;
    totalRefuel: number;
    count: number;
    monthlyStats?: Record<string, { totalDistance: number; totalRefuel: number; count: number }>;
    lastUpdatedAt?: string;
}

export const getDriveLogAggregatedStats = async (organizationId: string): Promise<AggregatedStats | null> => {
    const docRef = doc(db, 'organizations', organizationId, 'stats', 'aggregate');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return docSnap.data() as AggregatedStats;
    }
    return null;
};
