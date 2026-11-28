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
import { isDriveLogLocked } from '../../lib/driveLogLock';

interface AdjustParams {
    lastDriveLog: DriveLog | null;
    nextDriveLog: DriveLog | null;
    startKm: number;
    endKm: number;
    /**
     * 잠긴(운행일로부터 60일이 지난) 인접 기록도 맞출 수 있는가 — 운영자만 true.
     * 아니면 잠긴 기록은 건드리지 않고 어긋난 사실만 알린다. 서버 규칙이 어차피 거절하고,
     * 잠금의 뜻이 "지난 기록은 사후에 바뀌지 않는다"이기 때문이다.
     */
    canEditLocked?: boolean;
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
    canEditLocked = false,
}: AdjustParams): Promise<string[]> {
    const adjustMessages: string[] = [];
    const lastLocked = !canEditLocked && isDriveLogLocked(lastDriveLog);
    const nextLocked = !canEditLocked && isDriveLogLocked(nextDriveLog);

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

    if (lastDriveLog && lastEndKm !== startKm && lastLocked) {
        adjustMessages.push(
            `직전 기록은 운행일로부터 60일이 지나 잠겨 있어 도착 km ${lastEndKm?.toLocaleString()}을 그대로 두었습니다 (이 기록 출발 ${startKm.toLocaleString()})`,
        );
    } else if (lastDriveLog && lastEndKm !== startKm && photoAnchored) {
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

    // 직후 기록의 startKm → 현재 기록의 endKm으로 자동 변경 (도착 km는 그 운전자의 계기판 값이라 그대로 둔다)
    //
    // 서버 수정 트리거(alignNextLogStartKm)도 같은 규칙이다 — 어느 쪽이 먼저 저장되든 결과가 같다.
    // 단, 출발만 고치면 그 기록의 거리가 음수가 되는 경우(이 기록의 도착이 직후 기록의 도착보다 크다)는
    // 출발만으로 맞출 수 없다. 여기서 덮으면 서버가 "이미 맞다"며 멈춰 음수 거리가 남으므로 손대지 않고,
    // 서버가 뒤 기록을 함께 밀도록 맡긴다.
    const nextEndKm = nextDriveLog?.endKm;
    const wouldGoNegative = typeof nextEndKm === 'number' && endKm > nextEndKm;
    // 직후 기록은 이 기록보다 나중이라 보통 잠기지 않는다. 운영자가 잠긴 기록을 고칠 때만 해당한다.
    if (nextDriveLog && nextDriveLog.startKm !== endKm && nextLocked) {
        adjustMessages.push(`직후 기록은 운행일로부터 60일이 지나 잠겨 있어 출발 km를 그대로 두었습니다`);
    } else if (nextDriveLog && wouldGoNegative) {
        adjustMessages.push(`직후 기록부터 km가 ${endKm.toLocaleString()}에 이어지도록 함께 조정됩니다`);
    } else if (nextDriveLog && nextDriveLog.startKm !== endKm) {
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
