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
    findOwnerOverlappingReservation,
    getAutoTimes,
    calcEndTime,
    buildMultiDaySlots,
} from '../../hooks/utils/reservationUtils';
import type { Reservation } from '../../types/reservation';

describe('reservationUtils', () => {
    // 시간 관련 테스트는 Date를 모킹
    let originalDate: DateConstructor;

    beforeEach(() => {
        originalDate = globalThis.Date;
    });

    afterEach(() => {
        globalThis.Date = originalDate;
    });

    const mockDate = (isoString: string) => {
        const fixed = new originalDate(isoString);
        (globalThis as unknown as Record<string, unknown>).Date = class extends (originalDate as unknown as { new(...args: unknown[]): Date }) {
            constructor(...args: unknown[]) {
                super(...args);
                if (args.length === 0) return fixed;
                return new originalDate(...(args as [string]));
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
        ] as Reservation[];

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
                excludeId: 'r1' as Reservation['id'],
            });
            expect(result).toBeNull();
        });

        it('수정 중인 반복 그룹 전체를 제외한다', () => {
            // 그룹 수정은 지우고 다시 만드는 방식이라 자기 그룹은 충돌이 아니다.
            // 제외하지 않으면 그룹의 나머지 날짜에 걸려 시간을 아예 바꿀 수 없다.
            const group = [
                { id: 'g1', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-02-27', startTime: '09:00', endTime: '11:00', status: 'reserved' },
            ] as Reservation[];
            const result = findOverlappingReservation(group, {
                vehicleId: 'v1', date: '2026-02-27', startTime: '09:30', endTime: '10:30',
                excludeRecurringGroupId: 'rcr_1',
            });
            expect(result).toBeNull();
        });

        it('수정 중인 다일 그룹 전체를 제외한다', () => {
            const group = [
                { id: 'g1', vehicleId: 'v1', groupId: 'grp_1', date: '2026-02-27', startTime: '09:00', endTime: '11:00', status: 'reserved' },
            ] as Reservation[];
            const result = findOverlappingReservation(group, {
                vehicleId: 'v1', date: '2026-02-27', startTime: '09:30', endTime: '10:30',
                excludeGroupId: 'grp_1',
            });
            expect(result).toBeNull();
        });

        it('한 사람이 같은 시간에 다른 차량을 잡아 두면 사람 기준 검사가 잡는다', () => {
            // 차량 기준 검사는 v2를 보지 못한다 — 사람 기준 검사가 따로 필요한 이유
            const mine = [
                { id: 'm1', vehicleId: 'v2', reservedByUid: 'u1', date: '2026-02-27', startTime: '09:00', endTime: '11:00', status: 'reserved' },
            ] as Reservation[];
            expect(findOverlappingReservation(mine, {
                vehicleId: 'v1', date: '2026-02-27', startTime: '09:30', endTime: '10:30',
            })).toBeNull();
            expect(findOwnerOverlappingReservation(mine, {
                reservedByUid: 'u1', date: '2026-02-27', startTime: '09:30', endTime: '10:30',
            })!.id).toBe('m1');
        });

        it('사람 기준 검사도 남의 예약·취소·시간 어긋남은 잡지 않는다', () => {
            const others = [
                { id: 'o1', vehicleId: 'v2', reservedByUid: 'u2', date: '2026-02-27', startTime: '09:00', endTime: '11:00', status: 'reserved' },
                { id: 'o2', vehicleId: 'v3', reservedByUid: 'u1', date: '2026-02-27', startTime: '09:00', endTime: '11:00', status: 'cancelled' },
                { id: 'o3', vehicleId: 'v4', reservedByUid: 'u1', date: '2026-02-27', startTime: '13:00', endTime: '14:00', status: 'reserved' },
            ] as Reservation[];
            expect(findOwnerOverlappingReservation(others, {
                reservedByUid: 'u1', date: '2026-02-27', startTime: '09:30', endTime: '10:30',
            })).toBeNull();
        });

        it('사람 기준 검사도 운행이 끝난 예약은 실제 운행 시간만 점유한 것으로 본다', () => {
            // 09:00~12:00 예약을 09:00~09:30만 타고 완료 → 09:30부터는 본인도 다른 차를 잡을 수 있다
            const mine = [
                {
                    id: 'm1', vehicleId: 'v2', reservedByUid: 'u1', date: '2026-02-27',
                    startTime: '09:00', endTime: '12:00', status: 'completed',
                    actualStartTime: '09:00', actualEndTime: '09:30',
                },
            ] as Reservation[];
            expect(findOwnerOverlappingReservation(mine, {
                reservedByUid: 'u1', date: '2026-02-27', startTime: '09:30', endTime: '12:00',
            })).toBeNull();
        });

        it('사람 기준 검사도 수정 중인 자기 예약·그룹은 제외한다', () => {
            const mine = [
                { id: 'm1', vehicleId: 'v2', reservedByUid: 'u1', groupId: 'grp_1', date: '2026-02-27', startTime: '09:00', endTime: '11:00', status: 'reserved' },
            ] as Reservation[];
            expect(findOwnerOverlappingReservation(mine, {
                reservedByUid: 'u1', date: '2026-02-27', startTime: '09:30', endTime: '10:30',
                excludeGroupId: 'grp_1',
            })).toBeNull();
        });

        it('다른 그룹의 예약은 계속 충돌로 잡는다 (제외의 대조군)', () => {
            const group = [
                { id: 'g1', vehicleId: 'v1', recurringGroupId: 'rcr_2', date: '2026-02-27', startTime: '09:00', endTime: '11:00', status: 'reserved' },
            ] as Reservation[];
            const result = findOverlappingReservation(group, {
                vehicleId: 'v1', date: '2026-02-27', startTime: '09:30', endTime: '10:30',
                excludeRecurringGroupId: 'rcr_1',
            });
            expect(result!.id).toBe('g1');
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

    describe('buildMultiDaySlots', () => {
        it('첫날은 출발 시간부터, 중간 날은 하루 종일, 마지막 날은 반납 시간까지', () => {
            // 검증(충돌 검사)과 실제 생성이 이 목록 하나를 함께 본다 —
            // 어긋나면 "미리 확인은 통과했는데 중간 날짜에서 생성이 막히는" 상태가 된다.
            expect(buildMultiDaySlots('2026-08-10', '2026-08-12', '09:00', '17:00')).toEqual([
                { date: '2026-08-10', startTime: '09:00', endTime: '23:59' },
                { date: '2026-08-11', startTime: '00:00', endTime: '23:59' },
                { date: '2026-08-12', startTime: '00:00', endTime: '17:00' },
            ]);
        });

        it('이틀짜리는 중간 날 없이 첫날·마지막 날만', () => {
            expect(buildMultiDaySlots('2026-08-10', '2026-08-11', '09:00', '17:00')).toEqual([
                { date: '2026-08-10', startTime: '09:00', endTime: '23:59' },
                { date: '2026-08-11', startTime: '00:00', endTime: '17:00' },
            ]);
        });

        it('종료일이 시작일과 같거나 비어 있으면 하루짜리 1건', () => {
            expect(buildMultiDaySlots('2026-08-10', '2026-08-10', '09:00', '17:00')).toEqual([
                { date: '2026-08-10', startTime: '09:00', endTime: '17:00' },
            ]);
            expect(buildMultiDaySlots('2026-08-10', '', '09:00', '17:00')).toEqual([
                { date: '2026-08-10', startTime: '09:00', endTime: '17:00' },
            ]);
        });

        it('월을 넘겨도 날짜가 끊기지 않는다', () => {
            const slots = buildMultiDaySlots('2026-08-30', '2026-09-02', '09:00', '17:00');
            expect(slots.map(s => s.date)).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
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

});
