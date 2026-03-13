/**
 * reservationUtils 단위 테스트
 * 예약 시간 계산, 충돌 검사, 자동 시간 설정 검증
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    getCurrentTimeStr,
    getNextRoundedTime,
    getTodayStr,
    getMinStartTime,
    findOverlappingReservation,
    findUserOverlappingReservation,
    getAutoTimes,
    calcEndTime,
} from '../../hooks/utils/reservationUtils';

describe('reservationUtils', () => {
    // 시간 관련 테스트는 Date를 모킹
    let originalDate: any;

    beforeEach(() => {
        originalDate = globalThis.Date;
    });

    afterEach(() => {
        globalThis.Date = originalDate;
    });

    const mockDate = (isoString: string) => {
        const fixed = new originalDate(isoString);
        (globalThis as any).Date = class extends (originalDate as any) {
            constructor(...args: any[]) {
                super(...args);
                if (args.length === 0) return fixed;
                return new originalDate(...args);
            }
            static now() { return fixed.getTime(); }
        };
    };

    describe('getCurrentTimeStr', () => {
        it('현재 시간을 HH:MM 포맷으로 반환한다', () => {
            mockDate('2026-02-27T14:05:00+09:00');
            expect(getCurrentTimeStr()).toBe('14:05');
        });

        it('한 자리 시/분은 0으로 패딩한다', () => {
            mockDate('2026-02-27T09:03:00+09:00');
            expect(getCurrentTimeStr()).toBe('09:03');
        });
    });

    describe('getNextRoundedTime', () => {
        it('정각이면 그대로 반환한다', () => {
            mockDate('2026-02-27T14:00:00+09:00');
            expect(getNextRoundedTime()).toBe('14:00');
        });

        it('30분 이내면 XX:30으로 올린다', () => {
            mockDate('2026-02-27T14:15:00+09:00');
            expect(getNextRoundedTime()).toBe('14:30');
        });

        it('30분 초과면 다음 시간 정각으로 올린다', () => {
            mockDate('2026-02-27T14:45:00+09:00');
            expect(getNextRoundedTime()).toBe('15:00');
        });

        it('23시 30분 초과면 23:30을 반환한다 (24시 방지)', () => {
            mockDate('2026-02-27T23:45:00+09:00');
            expect(getNextRoundedTime()).toBe('23:30');
        });
    });

    describe('getTodayStr', () => {
        it('오늘 날짜를 YYYY-MM-DD로 반환한다', () => {
            mockDate('2026-02-27T14:00:00+09:00');
            expect(getTodayStr()).toBe('2026-02-27');
        });
    });

    describe('getMinStartTime', () => {
        it('오늘이면 현재 시각을 반환한다', () => {
            mockDate('2026-02-27T14:05:00+09:00');
            expect(getMinStartTime(true)).toBe('14:05');
        });

        it('오늘이 아니면 00:00을 반환한다', () => {
            expect(getMinStartTime(false)).toBe('00:00');
        });
    });

    describe('findOverlappingReservation', () => {
        const reservations = [
            { id: 'r1', vehicleId: 'v1', date: '2026-02-27', startTime: '09:00', endTime: '11:00', status: 'reserved' },
            { id: 'r2', vehicleId: 'v1', date: '2026-02-27', startTime: '14:00', endTime: '16:00', status: 'reserved' },
            { id: 'r3', vehicleId: 'v2', date: '2026-02-27', startTime: '09:00', endTime: '12:00', status: 'reserved' },
            { id: 'r4', vehicleId: 'v1', date: '2026-02-27', startTime: '18:00', endTime: '20:00', status: 'cancelled' },
        ];

        it('시간이 겹치는 예약을 찾는다', () => {
            const result = findOverlappingReservation(reservations, {
                vehicleId: 'v1', date: '2026-02-27', startTime: '10:00', endTime: '12:00',
            });
            expect(result).not.toBeNull();
            expect(result!.id).toBe('r1');
        });

        it('겹치지 않으면 null을 반환한다', () => {
            const result = findOverlappingReservation(reservations, {
                vehicleId: 'v1', date: '2026-02-27', startTime: '11:00', endTime: '14:00',
            });
            expect(result).toBeNull();
        });

        it('다른 차량의 예약과는 겹치지 않는다', () => {
            const result = findOverlappingReservation(reservations, {
                vehicleId: 'v1', date: '2026-02-27', startTime: '09:00', endTime: '12:00',
            });
            // v1의 r1과 겹침
            expect(result!.vehicleId).toBe('v1');
        });

        it('취소된 예약은 무시한다', () => {
            const result = findOverlappingReservation(reservations, {
                vehicleId: 'v1', date: '2026-02-27', startTime: '18:30', endTime: '19:30',
            });
            expect(result).toBeNull();
        });

        it('자기 자신은 제외한다 (수정 모드)', () => {
            const result = findOverlappingReservation(reservations, {
                vehicleId: 'v1', date: '2026-02-27', startTime: '09:30', endTime: '10:30',
                excludeId: 'r1' as any,
            });
            expect(result).toBeNull();
        });

        it('다른 날짜의 예약과는 겹치지 않는다', () => {
            const result = findOverlappingReservation(reservations, {
                vehicleId: 'v1', date: '2026-02-28', startTime: '09:00', endTime: '11:00',
            });
            expect(result).toBeNull();
        });
    });

    describe('calcEndTime', () => {
        it('편도 30분 → 09:00 + 120분 = 11:00', () => {
            expect(calcEndTime('09:00', 30)).toBe('11:00');
        });

        it('편도 0분 (경로 정보 없음) → 09:00 + 60분 = 10:00', () => {
            expect(calcEndTime('09:00', 0)).toBe('10:00');
        });

        it('기본값(인자 없음) → 09:00 + 60분 = 10:00', () => {
            expect(calcEndTime('09:00')).toBe('10:00');
        });

        it('편도 45분 → 14:30 + 150분 = 17:00', () => {
            expect(calcEndTime('14:30', 45)).toBe('17:00');
        });

        it('23시 초과 시 23:59로 캡핑', () => {
            expect(calcEndTime('22:00', 120)).toBe('23:59');
        });

        it('자정 직전 시작, 편도 0분 → 23:00 + 60 = 23:59 캡핑', () => {
            expect(calcEndTime('23:30', 0)).toBe('23:59');
        });
    });

    describe('getAutoTimes', () => {
        it('오늘이 아닌 날짜, durationMin 없음 → 09:00~10:00', () => {
            mockDate('2026-02-27T14:15:00+09:00');
            const result = getAutoTimes('2026-02-28');
            expect(result.startTime).toBe('09:00');
            expect(result.endTime).toBe('10:00');
        });

        it('오늘이 아닌 날짜, 편도 30분 → 09:00~11:00', () => {
            mockDate('2026-02-27T14:15:00+09:00');
            const result = getAutoTimes('2026-02-28', 30);
            expect(result.startTime).toBe('09:00');
            expect(result.endTime).toBe('11:00');
        });
    });

    describe('findUserOverlappingReservation', () => {
        const reservations = [
            { id: 'r1', vehicleId: 'v1', date: '2026-02-27', startTime: '09:00', endTime: '11:00', status: 'reserved', reservedByUid: 'user1' },
            { id: 'r2', vehicleId: 'v2', date: '2026-02-27', startTime: '14:00', endTime: '16:00', status: 'reserved', reservedByUid: 'user1' },
            { id: 'r3', vehicleId: 'v1', date: '2026-02-27', startTime: '09:00', endTime: '12:00', status: 'reserved', reservedByUid: 'user2' },
            { id: 'r4', vehicleId: 'v2', date: '2026-02-27', startTime: '18:00', endTime: '20:00', status: 'cancelled', reservedByUid: 'user1' },
        ];

        it('같은 사용자가 다른 차량에 겹치는 시간 예약이 있으면 반환한다', () => {
            const result = findUserOverlappingReservation(reservations, {
                reservedByUid: 'user1', date: '2026-02-27', startTime: '10:00', endTime: '12:00',
            });
            expect(result).not.toBeNull();
            expect(result!.id).toBe('r1');
        });

        it('겹치지 않으면 null을 반환한다', () => {
            const result = findUserOverlappingReservation(reservations, {
                reservedByUid: 'user1', date: '2026-02-27', startTime: '11:00', endTime: '14:00',
            });
            expect(result).toBeNull();
        });

        it('다른 사용자의 예약과는 겹치지 않는다', () => {
            const result = findUserOverlappingReservation(reservations, {
                reservedByUid: 'user1', date: '2026-02-27', startTime: '09:00', endTime: '12:00',
            });
            // user1의 r1과 겹침 (user2의 r3과는 무관)
            expect(result!.reservedByUid).toBe('user1');
        });

        it('취소된 예약은 무시한다', () => {
            const result = findUserOverlappingReservation(reservations, {
                reservedByUid: 'user1', date: '2026-02-27', startTime: '18:30', endTime: '19:30',
            });
            expect(result).toBeNull();
        });

        it('수정 모드에서 자기 자신은 제외한다', () => {
            const result = findUserOverlappingReservation(reservations, {
                reservedByUid: 'user1', date: '2026-02-27', startTime: '09:30', endTime: '10:30',
                excludeId: 'r1',
            });
            expect(result).toBeNull();
        });
    });
});
