/**
 * driveLogList/matchesSearch — 운행일지 검색어 매칭 순수 함수.
 * 화면 필터(useDriveLogList)와 내보내기 필터(useDriveLogExport)가
 * 동일한 기준을 쓰도록 단일 모듈로 공유한다.
 */
import type { DriveLogEntry } from '../../types/driveLog';

export const matchesSearch = (log: DriveLogEntry, search: string): boolean => {
    const s = search.toLowerCase();
    return Boolean(
        log.driverName?.toLowerCase().includes(s) ||
        log.vehicleName?.toLowerCase().includes(s) ||
        log.purpose?.toLowerCase().includes(s) ||
        log.destination?.toLowerCase().includes(s)
    );
};
