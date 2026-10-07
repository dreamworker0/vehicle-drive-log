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
import { actorStamp } from '../../lib/firestore/actorStamp';

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
    //
    // 단, 그 값이 **사진으로 확인한 도착 계기판**이면 덮지 않는다. 남의 수정 한 번에
    // 증빙으로 찍어 둔 숫자가 바뀌면 기록의 근거가 사라진다 — 어긋난 사실만 알린다.
    //
    // 겹치는 쪽(직전 도착이 이 기록 출발보다 **큰** 경우)은 예외다. 그대로 두면 그 구간이
    // 두 기록에 함께 잡혀 기관 주행거리가 실제보다 늘어난다. 서버 재정합도 같은 경계를
    // 쓴다(거리가 음수가 되면 고정을 포기한다) — 숫자가 어긋난 채 부풀려지는 것이
    // 사진 값을 지키는 것보다 나쁘다고 본다. 대신 무엇을 왜 건드렸는지 알린다.
    const lastEndKm = lastDriveLog?.endKm;
    const photoAnchored = lastDriveLog?.endKmSource === 'ocr' && (lastEndKm ?? 0) < startKm;

    if (lastDriveLog && lastEndKm !== startKm && photoAnchored) {
        adjustMessages.push(
            `직전 기록의 도착 km ${lastEndKm?.toLocaleString()}은 사진으로 확인된 값이라 그대로 두었습니다 (이 기록 출발 ${startKm.toLocaleString()})`,
        );
    } else if (lastDriveLog && lastEndKm !== startKm) {
        try {
            await updateDoc(doc(db, 'driveLogs', lastDriveLog.id), {
                endKm: startKm,
                ...actorStamp(),
                editedAt: serverTimestamp(),
            });
            adjustMessages.push(
                lastDriveLog.endKmSource === 'ocr'
                    ? `직전 기록 도착 km: ${lastEndKm?.toLocaleString()} → ${startKm.toLocaleString()} (사진으로 확인된 값이지만 구간이 겹쳐 맞췄습니다)`
                    : `직전 기록 도착 km: ${lastEndKm?.toLocaleString()} → ${startKm.toLocaleString()}`,
            );
        } catch (err) {
            console.error('직전 기록 자동 조정 실패:', err);
        }
    }

    // 직후 기록의 startKm → 현재 기록의 endKm으로 자동 변경
    if (nextDriveLog && nextDriveLog.startKm !== endKm) {
        try {
            await updateDoc(doc(db, 'driveLogs', nextDriveLog.id), {
                startKm: endKm,
                ...actorStamp(),
                editedAt: serverTimestamp(),
            });
            adjustMessages.push(`직후 기록 출발 km: ${nextDriveLog.startKm?.toLocaleString()} → ${endKm.toLocaleString()}`);
        } catch (err) {
            console.error('직후 기록 자동 조정 실패:', err);
        }
    }

    return adjustMessages;
}
