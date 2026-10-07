import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getKSTMonthKey } from "../../utils/kstDate";
import { markStaleMonths } from "./staleMonths";

/** 타임스탬프에서 월 키(YYYY-MM) 추출 */
export const getMonthKey = (data: FirebaseFirestore.DocumentData | undefined): string | null => {
    if (!data) return null;
    const ts = data.timestamp;
    if (ts && typeof ts.toDate === "function") {
        return getKSTMonthKey(ts.toDate());
    }
    if (ts instanceof Date) {
        return getKSTMonthKey(ts);
    }
    return null;
};

/** 운행 거리 계산 (endKm - startKm, 음수 방지) */
export const calcDistance = (data: FirebaseFirestore.DocumentData | undefined): number => {
    if (!data) return 0;
    const dist = (data.endKm || 0) - (data.startKm || 0);
    return dist > 0 ? dist : 0;
};

/**
 * 운행일지 생성 시 기관 통계 증분
 */
export async function handleStatsOnCreate(orgId: string, afterData: FirebaseFirestore.DocumentData): Promise<void> {
    const db = getFirestore();
    const orgStatsRef = db.collection("organizations").doc(orgId).collection("stats").doc("aggregate");

    const dist = calcDistance(afterData);
    const monthKey = getMonthKey(afterData);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {
        count: FieldValue.increment(1),
        totalDistance: FieldValue.increment(dist),
        lastUpdatedAt: FieldValue.serverTimestamp(),
    };

    if (monthKey) {
        payload.monthlyStats = {
            [monthKey]: {
                count: FieldValue.increment(1),
                totalDistance: FieldValue.increment(dist),
            },
        };
    }

    try {
        await orgStatsRef.set(payload, { merge: true });
    } catch (error) {
        console.error(`[handleStatsOnCreate] 통계 업데이트 실패 (${orgId}):`, error);
    }
    // 지난달 이전에 소급 입력한 기록 — 야간 집계가 그 달을 다시 계산하도록 표시한다
    await markStaleMonths(orgId, [monthKey]);
}

/**
 * 운행일지 수정 시 기관 통계 차분 반영
 */
export async function handleStatsOnUpdate(orgId: string, beforeData: FirebaseFirestore.DocumentData, afterData: FirebaseFirestore.DocumentData): Promise<void> {
    const db = getFirestore();
    const orgStatsRef = db.collection("organizations").doc(orgId).collection("stats").doc("aggregate");

    const beforeDist = calcDistance(beforeData);
    const afterDist = calcDistance(afterData);
    const distanceChange = afterDist - beforeDist;
    const beforeMonth = getMonthKey(beforeData);
    const afterMonth = getMonthKey(afterData);
    const monthChanged = beforeMonth && afterMonth && beforeMonth !== afterMonth;

    // 거리가 그대로여도 운전자·시각·하이패스 등이 바뀌면 그 달 분석 숫자가 달라진다 — 아래 조기 반환보다 먼저
    await markStaleMonths(orgId, [beforeMonth, afterMonth]);

    if (distanceChange === 0 && !monthChanged) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {
        totalDistance: FieldValue.increment(distanceChange),
        lastUpdatedAt: FieldValue.serverTimestamp(),
    };

    if (monthChanged) {
        payload.count = FieldValue.increment(0);
        payload.monthlyStats = {
            [beforeMonth!]: {
                count: FieldValue.increment(-1),
                totalDistance: FieldValue.increment(-beforeDist),
            },
            [afterMonth!]: {
                count: FieldValue.increment(1),
                totalDistance: FieldValue.increment(afterDist),
            },
        };
    } else if (distanceChange !== 0 && afterMonth) {
        payload.monthlyStats = {
            [afterMonth]: {
                totalDistance: FieldValue.increment(distanceChange),
            },
        };
    }

    try {
        await orgStatsRef.set(payload, { merge: true });
    } catch (error) {
        console.error(`[handleStatsOnUpdate] 통계 업데이트 실패 (${orgId}):`, error);
    }
}

/**
 * 운행일지 삭제 시 기관 통계 차감
 */
export async function handleStatsOnDelete(orgId: string, beforeData: FirebaseFirestore.DocumentData): Promise<void> {
    const db = getFirestore();
    const orgStatsRef = db.collection("organizations").doc(orgId).collection("stats").doc("aggregate");

    const dist = calcDistance(beforeData);
    const monthKey = getMonthKey(beforeData);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {
        count: FieldValue.increment(-1),
        totalDistance: FieldValue.increment(-dist),
        lastUpdatedAt: FieldValue.serverTimestamp(),
    };

    if (monthKey) {
        payload.monthlyStats = {
            [monthKey]: {
                count: FieldValue.increment(-1),
                totalDistance: FieldValue.increment(-dist),
            },
        };
    }

    try {
        await orgStatsRef.set(payload, { merge: true });
    } catch (error) {
        console.error(`[handleStatsOnDelete] 통계 업데이트 실패 (${orgId}):`, error);
    }
    // 보존 기한 정리(3년)로 지워진 기록은 1년 표시 범위 밖이라 표시되지 않는다(staleMonths.ts)
    await markStaleMonths(orgId, [monthKey]);
}
