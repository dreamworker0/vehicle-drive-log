/**
 * Firestore — 주유 기록 (Fuel Logs) 관련 함수
 */
import {
    doc, deleteDoc, updateDoc,
    collection, query, where, getDocs, addDoc,
    orderBy, limit, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { captureError } from '../sentry';
import { toLocalDateStr } from '../dateUtils';
import { createZodConverter, fuelLogSchema } from '../../schemas';

// 읽기 경로에 스키마 검증을 건다 — 이전에는 `d.data() as Record<string, unknown>`으로
// 캐스팅해 반환하고 호출부에서 다시 `as FuelLog[]`로 받아, 두 캐스팅 사이에 실제
// 검증이 없었다. 파싱 실패는 화면을 깨지 않고 Sentry로만 보고된다(createZodConverter).
const fuelLogsRef = () => collection(db, 'fuelLogs').withConverter(createZodConverter(fuelLogSchema));

// 기간(since/until) 조회 상한 — 내보내기·월간 보고서가 운행일지 상한(EXPORT_MAX_DOCS=5000)까지
// 조인하므로 동일 수준으로 맞춘다. 기간 없는 화면 목록 조회는 기존대로 200건 유지.
const RANGE_FETCH_MAX = 5000;
const LIST_FETCH_MAX = 200;

/** 주유 기록 목록 조회 (기관 전체, 최신순 — 기간 지정 시 상한 5,000건, 미지정 시 200건) */
export const getFuelLogs = async (orgId: string, vehicleId: string | null = null, options?: { since?: Date | string; until?: Date | string }) => {
    const constraints: import('firebase/firestore').QueryConstraint[] = [
        where('organizationId', '==', orgId),
    ];
    if (vehicleId) {
        constraints.push(where('vehicleId', '==', vehicleId));
    }
    if (options?.since) {
        constraints.push(where('date', '>=', options.since instanceof Date
            ? toLocalDateStr(options.since) : options.since));
    }
    if (options?.until) {
        constraints.push(where('date', '<=', options.until instanceof Date
            ? toLocalDateStr(options.until) : options.until));
    }
    const hasRange = Boolean(options?.since || options?.until);
    constraints.push(orderBy('date', 'desc'), limit(hasRange ? RANGE_FETCH_MAX : LIST_FETCH_MAX));
    const q = query(fuelLogsRef(), ...constraints);
    const snap = await getDocs(q);
    if (hasRange && snap.docs.length >= RANGE_FETCH_MAX) {
        console.warn(`[getFuelLogs] 기간 조회가 상한 ${RANGE_FETCH_MAX}건에 도달 — 이후 주유 기록은 조인에서 누락될 수 있습니다.`);
    }
    return snap.docs.map(d => ({ ...d.data(), id: d.id }));
};

/** 주유 기록 생성 */
export const createFuelLog = async (data: Record<string, unknown>) => {
    try {
        const docRef = await addDoc(collection(db, 'fuelLogs'), {
            ...data,
            createdAt: serverTimestamp(),
        });
        return docRef;
    } catch (error) {
        captureError(error as Error, { context: 'createFuelLog', data });
        throw error;
    }
};

/** 주유 기록 삭제 */
export const deleteFuelLog = async (logId: string) => {
    try {
        await deleteDoc(doc(db, 'fuelLogs', logId));
    } catch (error) {
        captureError(error as Error, { context: 'deleteFuelLog', logId });
        throw error;
    }
};

/** 주유 기록 수정 */
export const updateFuelLog = async (logId: string, data: Record<string, unknown>) => {
    try {
        await updateDoc(doc(db, 'fuelLogs', logId), {
            ...data,
            updatedAt: serverTimestamp(),
        });
    } catch (error) {
        captureError(error as Error, { context: 'updateFuelLog', logId, data });
        throw error;
    }
};
