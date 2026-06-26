/**
 * driveLogForm/adjustAdjacentLogs.ts
 * 운행일지 수정 모드 저장 후, 직전 기록의 도착 km와 직후 기록의 출발 km를
 * 현재 기록에 맞춰 자동 조정한다. (useDriveLogSubmit.handleSubmit에서 추출)
 *
 * 각 조정은 부가 작업이므로 실패해도 본 저장을 되돌리지 않고 개별적으로 삼킨다.
 */
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { DriveLog } from '../../types/driveLog';

interface AdjustParams {
    lastDriveLog: DriveLog | null;
    nextDriveLog: DriveLog | null;
    startKm: number;
    endKm: number;
}

/**
 * 인접 기록 km 자동 조정.
 * @returns 사용자에게 안내할 조정 메시지 목록 (조정이 없으면 빈 배열)
 */
export async function adjustAdjacentLogs({
    lastDriveLog,
    nextDriveLog,
    startKm,
    endKm,
}: AdjustParams): Promise<string[]> {
    const adjustMessages: string[] = [];

    // 직전 기록의 endKm → 현재 기록의 startKm으로 자동 변경
    if (lastDriveLog && lastDriveLog.endKm !== startKm) {
        try {
            await updateDoc(doc(db, 'driveLogs', lastDriveLog.id), {
                endKm: startKm,
                editedAt: serverTimestamp(),
            });
            adjustMessages.push(`직전 기록 도착 km: ${lastDriveLog.endKm?.toLocaleString()} → ${startKm.toLocaleString()}`);
        } catch (err) {
            console.error('직전 기록 자동 조정 실패:', err);
        }
    }

    // 직후 기록의 startKm → 현재 기록의 endKm으로 자동 변경
    if (nextDriveLog && nextDriveLog.startKm !== endKm) {
        try {
            await updateDoc(doc(db, 'driveLogs', nextDriveLog.id), {
                startKm: endKm,
                editedAt: serverTimestamp(),
            });
            adjustMessages.push(`직후 기록 출발 km: ${nextDriveLog.startKm?.toLocaleString()} → ${endKm.toLocaleString()}`);
        } catch (err) {
            console.error('직후 기록 자동 조정 실패:', err);
        }
    }

    return adjustMessages;
}
