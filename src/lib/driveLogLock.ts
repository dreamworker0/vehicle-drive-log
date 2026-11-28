/**
 * 운행일지 수정 잠금 — 운행일(도착일)로부터 60일이 지난 운행일지는 새로 쓰기·고치기·지우기를 모두 막는다.
 *
 * 모든 기관에 예외 없이 적용하고, 기관 관리자도 잠긴다. 풀 수 있는 사람은 운영자(superAdmin)뿐이다.
 * 지원 차량 운행일지를 외부(공동모금회 등)에 증빙으로 낼 때 "지난 기록은 사후에 바뀌지 않는다"를
 * 프로그램이 보장하기 위한 장치다(2026-11-28 운영자 결정).
 *
 * ## 기한을 60일로 잡은 근거
 * 2026-07-30~11-28 접속기록에서 사람이 운행일지를 고친 3,248건을 운행일 기준으로 나눴다.
 * 30일 안이 94%, 31~60일이 6%(대부분 관리자의 월말 정리), 61일 이후는 2건(0.1%)이었다.
 * 30일로 줄이면 정당한 월말 정리까지 막히고, 60일이면 실제 업무에 걸리는 수정이 거의 없다.
 *
 * ## 최종 방어선은 서버다
 * 화면의 검사는 미리 막고 이유를 알려 주는 용도이고, 막는 곳은 `firestore.rules`의
 * `driveLogLocked`다. 서버는 하루를 더 얹은 **61일**로 끊는다 — 화면이 허용한 날짜(그날 00:00부터)의
 * 어느 시각도 서버에서 거절되지 않게 하려는 것이다. 그래서 화면이 항상 서버보다 먼저 잠근다.
 * 서버 함수(중복 정리)는 `functions/src/utils/driveLogLock.ts`에 같은 61일 기준을 둔다.
 *
 * 운행일을 모르는 기록(timestamp가 없거나 시각 형식이 아닌 옛 기록)은 서버처럼 잠그지 않는다.
 */
import { toLocalDateStr } from './dateUtils';

/** 운행일로부터 이 날수가 지나면 잠긴다 */
export const DRIVE_LOG_LOCK_DAYS = 60;

export const DRIVE_LOG_LOCKED_MESSAGE =
    `운행일로부터 ${DRIVE_LOG_LOCK_DAYS}일이 지난 운행일지는 고치거나 지울 수 없습니다. 바로잡아야 하면 운영자에게 문의해 주세요.`;

export const DRIVE_LOG_DATE_TOO_OLD_MESSAGE =
    `운행일로부터 ${DRIVE_LOG_LOCK_DAYS}일이 지난 날짜로는 운행일지를 쓰거나 옮길 수 없습니다.`;

/** 아직 쓰거나 고칠 수 있는 가장 이른 운행일 'YYYY-MM-DD' — 날짜 칸의 최솟값으로도 쓴다 */
export function getEditableFromDateStr(now: Date = new Date()): string {
    return toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - DRIVE_LOG_LOCK_DAYS));
}

/** 서버 규칙과 같은 기준 — Timestamp 또는 Date일 때만 운행일로 본다 */
function arrivalDateStr(timestamp: unknown): string | null {
    if (timestamp instanceof Date) return isNaN(timestamp.getTime()) ? null : toLocalDateStr(timestamp);
    if (timestamp && typeof timestamp === 'object' && 'toDate' in timestamp
        && typeof (timestamp as { toDate: unknown }).toDate === 'function') {
        const d = (timestamp as { toDate: () => Date }).toDate();
        return d instanceof Date && !isNaN(d.getTime()) ? toLocalDateStr(d) : null;
    }
    return null;
}

/** 운행일이 잠금 기한을 넘겼는가 */
export function isDriveLogLocked(log: { timestamp?: unknown } | null | undefined, now: Date = new Date()): boolean {
    const date = arrivalDateStr(log?.timestamp);
    return !!date && date < getEditableFromDateStr(now);
}

/** 잠긴 기록을 다룰 수 있는 역할 — 운영자뿐이다 */
export function canBypassDriveLogLock(role: string | null | undefined): boolean {
    return role === 'superAdmin';
}

/** 잠금 때문에 이 기록을 고치거나 지울 수 없는가 (버튼 표시용) */
export function isDriveLogLockedFor(log: { timestamp?: unknown } | null | undefined, role: string | null | undefined, now: Date = new Date()): boolean {
    return !canBypassDriveLogLock(role) && isDriveLogLocked(log, now);
}

/**
 * 저장 직전 검사 — 막아야 하면 사용자에게 보일 이유를, 아니면 null.
 *
 * - 수정: 원래 기록이 잠겼으면 막는다.
 * - 쓰기·수정 공통: 저장될 도착일(`arrivalDate`, 'YYYY-MM-DD')이 기한 밖이면 막는다.
 *   잠기지 않은 기록을 잠긴 날짜로 옮겨 사실상 지난 기록을 바꾸는 길도 이것으로 막힌다.
 */
export function getDriveLogLockError(params: {
    role: string | null | undefined;
    isEditMode: boolean;
    editLog: { timestamp?: unknown } | null | undefined;
    arrivalDate: string;
    now?: Date;
}): string | null {
    const { role, isEditMode, editLog, arrivalDate, now = new Date() } = params;
    if (canBypassDriveLogLock(role)) return null;
    if (isEditMode && isDriveLogLocked(editLog, now)) return DRIVE_LOG_LOCKED_MESSAGE;
    if (arrivalDate && arrivalDate < getEditableFromDateStr(now)) return DRIVE_LOG_DATE_TOO_OLD_MESSAGE;
    return null;
}
