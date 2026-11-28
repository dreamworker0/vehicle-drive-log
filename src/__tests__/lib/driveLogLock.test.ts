/**
 * driveLogLock — 운행일지 수정 잠금(운행일로부터 60일, 운영자만 예외)
 * 서버 규칙(firestore.rules driveLogLocked, 61일)과 어긋나지 않는지도 함께 고정한다.
 */
import { describe, it, expect } from 'vitest';
import {
    DRIVE_LOG_LOCK_DAYS,
    getEditableFromDateStr,
    isDriveLogLocked,
    isDriveLogLockedFor,
    getDriveLogLockError,
    DRIVE_LOG_LOCKED_MESSAGE,
    DRIVE_LOG_DATE_TOO_OLD_MESSAGE,
} from '../../lib/driveLogLock';

// 2026-11-28 15:00 (로컬)
const NOW = new Date(2026, 10, 28, 15, 0);
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h);
const ts = (date: Date) => ({ toDate: () => date });

describe('driveLogLock', () => {
    it('기한은 60일이고, 고를 수 있는 가장 이른 날은 오늘로부터 60일 전이다', () => {
        expect(DRIVE_LOG_LOCK_DAYS).toBe(60);
        expect(getEditableFromDateStr(NOW)).toBe('2026-09-29');
    });

    it('60일 전 날짜까지는 열려 있고, 61일 전부터 잠긴다', () => {
        expect(isDriveLogLocked({ timestamp: ts(at(2026, 9, 29, 0)) }, NOW)).toBe(false);
        expect(isDriveLogLocked({ timestamp: ts(at(2026, 9, 28, 23)) }, NOW)).toBe(true);
        expect(isDriveLogLocked({ timestamp: at(2026, 7, 1) }, NOW)).toBe(true);
    });

    it('운행일을 알 수 없는 기록(시각이 문자열·없음)은 잠그지 않는다 — 서버 규칙과 같다', () => {
        expect(isDriveLogLocked({ timestamp: '2026-07-01' }, NOW)).toBe(false);
        expect(isDriveLogLocked({}, NOW)).toBe(false);
        expect(isDriveLogLocked(null, NOW)).toBe(false);
    });

    it('화면이 허용하는 가장 이른 날짜의 어느 시각도 서버(61일) 기준에서는 잠기지 않는다', () => {
        // 서버: timestamp < now - 61일이면 거절. 화면이 허용한 날의 00:00이 그보다 늦어야 한다.
        const earliestAllowed = new Date(2026, 8, 29, 0, 0);
        const serverCutoff = new Date(NOW.getTime() - 61 * 24 * 60 * 60 * 1000);
        expect(earliestAllowed.getTime()).toBeGreaterThan(serverCutoff.getTime());
    });

    it('운영자(superAdmin)만 잠긴 기록을 다룰 수 있다 — 기관 관리자도 잠긴다', () => {
        const old = { timestamp: ts(at(2026, 7, 1)) };
        expect(isDriveLogLockedFor(old, 'employee', NOW)).toBe(true);
        expect(isDriveLogLockedFor(old, 'admin', NOW)).toBe(true);
        expect(isDriveLogLockedFor(old, 'superAdmin', NOW)).toBe(false);
    });

    describe('getDriveLogLockError — 저장 직전 검사', () => {
        const old = { timestamp: ts(at(2026, 7, 1)) };
        const recent = { timestamp: ts(at(2026, 11, 20)) };

        it('잠긴 기록을 고치려 하면 막는다', () => {
            expect(getDriveLogLockError({ role: 'admin', isEditMode: true, editLog: old, arrivalDate: '2026-07-01', now: NOW }))
                .toBe(DRIVE_LOG_LOCKED_MESSAGE);
        });

        it('열린 기록을 잠긴 날짜로 옮기는 것도 막는다', () => {
            expect(getDriveLogLockError({ role: 'employee', isEditMode: true, editLog: recent, arrivalDate: '2026-09-01', now: NOW }))
                .toBe(DRIVE_LOG_DATE_TOO_OLD_MESSAGE);
        });

        it('잠긴 날짜로 새로 쓰는 것(소급 입력)을 막는다', () => {
            expect(getDriveLogLockError({ role: 'employee', isEditMode: false, editLog: null, arrivalDate: '2026-09-28', now: NOW }))
                .toBe(DRIVE_LOG_DATE_TOO_OLD_MESSAGE);
        });

        it('기한 안이면 통과한다', () => {
            expect(getDriveLogLockError({ role: 'employee', isEditMode: true, editLog: recent, arrivalDate: '2026-11-20', now: NOW })).toBeNull();
            expect(getDriveLogLockError({ role: 'employee', isEditMode: false, editLog: null, arrivalDate: '2026-09-29', now: NOW })).toBeNull();
        });

        it('운영자는 잠긴 기록도 고칠 수 있다', () => {
            expect(getDriveLogLockError({ role: 'superAdmin', isEditMode: true, editLog: old, arrivalDate: '2026-07-01', now: NOW })).toBeNull();
        });
    });
});
