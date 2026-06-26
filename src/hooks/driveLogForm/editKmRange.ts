/**
 * driveLogForm/editKmRange.ts
 * 운행일지 수정 모드에서 출발/도착 km가 직전·직후 기록의 범위 안에 있는지 검증한다.
 * (useDriveLogSubmit.handleSubmit에서 추출한 순수 함수)
 */
import type { DriveLogForm } from './types';
import type { DriveLog } from '../../types/driveLog';

/**
 * 수정 모드 km 범위 검증.
 * @returns 위반 메시지(사용자 안내용) 또는 위반이 없으면 null
 */
export function validateEditKmRange(
    form: DriveLogForm,
    lastDriveLog: DriveLog | null,
    nextDriveLog: DriveLog | null,
): string | null {
    const startKm = Number(form.startKm || 0);
    const endKm = Number(form.endKm || 0);

    if (lastDriveLog && startKm < (lastDriveLog.startKm || 0)) {
        return `출발 km는 직전 기록의 출발(${lastDriveLog.startKm?.toLocaleString()} km) 이상이어야 합니다.`;
    }
    if (nextDriveLog && endKm > (nextDriveLog.endKm || 0)) {
        return `도착 km는 직후 기록의 도착(${nextDriveLog.endKm?.toLocaleString()} km) 이하여야 합니다.`;
    }
    return null;
}
