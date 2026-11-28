/**
 * 운행일지 수정 잠금 — 서버 함수용 기준.
 *
 * 운행일(도착 시각 `timestamp`)로부터 기한이 지난 운행일지는 운영자(superAdmin) 말고는 쓰기·고치기·지우기를
 * 할 수 없다. 규칙의 원본과 근거는 `src/lib/driveLogLock.ts` 머리말에 있다.
 *
 * 화면은 60일, 서버(firestore.rules `driveLogLocked`와 이 파일)는 하루를 얹은 **61일**로 끊는다 — 화면이
 * 허용한 날짜의 어느 시각도 서버에서 거절되지 않게 하려는 것이다. Admin SDK 쓰기는 Rules를 거치지 않으므로,
 * 관리자 요청으로 운행일지를 바꾸거나 지우는 서버 함수는 이 기준을 직접 지켜야 한다.
 */
export const DRIVE_LOG_LOCK_SERVER_DAYS = 61;

/** 운행일이 잠금 기한을 넘겼는가. 운행일을 모르면(시각이 아니면) 잠그지 않는다 — Rules와 같은 기준 */
export function isDriveLogLockedOnServer(timestamp: Date | null | undefined, now: Date = new Date()): boolean {
    if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) return false;
    return timestamp.getTime() < now.getTime() - DRIVE_LOG_LOCK_SERVER_DAYS * 24 * 60 * 60 * 1000;
}
