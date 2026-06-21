import { getFirestore, DocumentReference } from "firebase-admin/firestore";

/**
 * 타임스탬프, Date, 문자열 등을 밀리초 단위 숫자로 변환합니다.
 */
function getTimestamp(value: unknown): number {
    if (!value) return 0;
    if (typeof (value as { toMillis?: unknown }).toMillis === 'function') {
        return (value as { toMillis: () => number }).toMillis();
    }
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return new Date(value).getTime();
    return 0;
}

/**
 * Last-Writer-Wins (LWW) 정책에 따라 충돌 여부를 판단합니다.
 * 반환값이 true이면 새로 들어온 데이터가 구형 데이터이므로 덮어쓰기를 롤백해야 합니다.
 */
export function shouldRevertLWW(beforeData: FirebaseFirestore.DocumentData | undefined, afterData: FirebaseFirestore.DocumentData | undefined): boolean {
    if (!beforeData || !afterData) return false;

    // 클라이언트에서 기록한 최종 수정 시간(clientUpdatedAt) 또는 서버 수정 시간(updatedAt) 비교
    const beforeTime = getTimestamp(beforeData.clientUpdatedAt || beforeData.updatedAt);
    const afterTime = getTimestamp(afterData.clientUpdatedAt || afterData.updatedAt);

    // after의 시간이 명확히 존재하고 before보다 과거인 경우 충돌 (오프라인 구형 데이터 동기화 등)
    if (beforeTime > 0 && afterTime > 0 && afterTime < beforeTime) {
        return true;
    }
    return false;
}

/**
 * 운행일지 충돌 해결
 * LWW 위반 시 기존 데이터로 롤백하고 true를 반환합니다.
 */
export async function resolveDriveLogConflict(docRef: DocumentReference, beforeData: FirebaseFirestore.DocumentData, afterData: FirebaseFirestore.DocumentData): Promise<boolean> {
    if (shouldRevertLWW(beforeData, afterData)) {
        await docRef.set(beforeData);
        console.warn(`[ConflictResolver] DriveLog ${docRef.id} - 구형 데이터 덮어쓰기 감지. 이전 데이터로 롤백했습니다.`);
        return true; // 충돌 발생 및 롤백됨
    }
    return false;
}

/**
 * 예약 데이터 충돌 해결 (LWW 위반 확인)
 */
export async function resolveReservationConflict(docRef: DocumentReference, beforeData: FirebaseFirestore.DocumentData, afterData: FirebaseFirestore.DocumentData): Promise<boolean> {
    if (shouldRevertLWW(beforeData, afterData)) {
        await docRef.set(beforeData);
        console.warn(`[ConflictResolver] Reservation ${docRef.id} - 구형 데이터 덮어쓰기 감지. 이전 데이터로 롤백했습니다.`);
        return true;
    }
    return false;
}

/**
 * 예약 시간 겹침 충돌 확인 (오프라인 동기화로 인한 중복 예약 방어)
 * 반환값이 true이면 해당 시간대에 겹치는 다른 예약이 존재함을 의미합니다.
 */
export async function checkReservationTimeConflict(
    vehicleId: string,
    date: string,
    startTime: string,
    endTime: string,
    excludeReservationId?: string
): Promise<boolean> {
    if (!vehicleId || !date) return false;

    const db = getFirestore();
    const q = db.collection('reservations')
        .where('vehicleId', '==', vehicleId)
        .where('date', '==', date)
        .where('status', 'in', ['pending', 'reserved']);

    const snap = await q.get();

    for (const doc of snap.docs) {
        if (doc.id === excludeReservationId) continue;
        const data = doc.data();

        // 시간 범위 검사 로직: (s1 < e2) && (e1 > s2)
        const s1 = startTime || '00:00';
        const e1 = endTime || '23:59';
        const s2 = data.startTime || '00:00';
        const e2 = data.endTime || '23:59';

        if (s1 < e2 && e1 > s2) {
            return true; // 겹침
        }
    }
    return false;
}
