import { getFirestore } from "firebase-admin/firestore";

/*
 * 예전 이 자리에는 Last-Writer-Wins 롤백(shouldRevertLWW·resolveDriveLogConflict·resolveReservationConflict)이
 * 있었다. 비교할 시각(`clientUpdatedAt`·`updatedAt`)을 운행일지·예약 어디에서도 기록하지 않아 **한 번도
 * 동작하지 않았고**, 시각을 심는 순간 잠들어 있던 `docRef.set(before)` 롤백이 처음 켜지는 위험만 남아
 * 지웠다(2026-11-11). 오프라인 쓰기는 Firestore SDK 한 경로로 보낸다 — src/lib/offline/syncQueue.ts 머리 주석.
 */

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
