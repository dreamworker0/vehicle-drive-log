/**
 * driveLogExportFields 테스트 — Excel/PDF 내보내기 공용 필드 해석 헬퍼
 */
import { describe, it, expect } from 'vitest';
import {
    resolveStartKm, resolveEndKm, resolveDistance, resolveDateStr, resolveStartTime, resolveEndTime,
} from '../../lib/driveLogExportFields';
import { toLocalDateStr } from '../../lib/dateUtils';

describe('resolveStartKm / resolveEndKm', () => {
    it('신 필드(departureKm/arrivalKm)를 우선한다', () => {
        expect(resolveStartKm({ departureKm: 100, startKm: 999 })).toBe(100);
        expect(resolveEndKm({ arrivalKm: 200, endKm: 999 })).toBe(200);
    });

    it('신 필드가 없으면 구 필드(startKm/endKm)로 폴백한다', () => {
        expect(resolveStartKm({ startKm: 50 })).toBe(50);
        expect(resolveEndKm({ endKm: 80 })).toBe(80);
    });

    it('0은 유효값으로 보존한다 (?? 사용)', () => {
        expect(resolveStartKm({ departureKm: 0, startKm: 5 })).toBe(0);
        expect(resolveEndKm({ arrivalKm: 0, endKm: 5 })).toBe(0);
    });

    it('둘 다 없으면 undefined', () => {
        expect(resolveStartKm({})).toBeUndefined();
        expect(resolveEndKm({})).toBeUndefined();
    });
});

describe('resolveDistance', () => {
    it('도착-출발 양수를 반환한다', () => {
        expect(resolveDistance({ departureKm: 1000, arrivalKm: 1050 })).toBe(50);
        expect(resolveDistance({ startKm: 1000, endKm: 1080 })).toBe(80);
    });

    it('음수/0이면 0을 반환한다 (오입력 방어)', () => {
        expect(resolveDistance({ departureKm: 1050, arrivalKm: 1000 })).toBe(0);
        expect(resolveDistance({ startKm: 100, endKm: 100 })).toBe(0);
    });

    it('필드가 비면 0', () => {
        expect(resolveDistance({})).toBe(0);
    });
});

describe('resolveDateStr', () => {
    it('date 문자열을 우선한다', () => {
        expect(resolveDateStr({ date: '2026-03-05' })).toBe('2026-03-05');
    });

    it('date가 없으면 timestamp를 로컬 날짜로 변환한다', () => {
        const d = new Date('2026-03-05T09:00:00');
        expect(resolveDateStr({ timestamp: { toDate: () => d } })).toBe(toLocalDateStr(d));
    });

    it('둘 다 없으면 fallback을 반환한다', () => {
        expect(resolveDateStr({})).toBe('');
        expect(resolveDateStr({}, '-')).toBe('-');
    });
});

describe('resolveStartTime / resolveEndTime', () => {
    it('신 필드(startTime/endTime)를 우선한다', () => {
        expect(resolveStartTime({ startTime: '09:00', departureTime: '08:00' })).toBe('09:00');
        expect(resolveEndTime({ endTime: '10:00', arrivalTime: '11:00' })).toBe('10:00');
    });

    it('신 필드가 없으면 구 필드(departureTime/arrivalTime)로 폴백한다', () => {
        expect(resolveStartTime({ departureTime: '08:30' })).toBe('08:30');
        expect(resolveEndTime({ arrivalTime: '12:00' })).toBe('12:00');
    });

    it('둘 다 없으면 빈 문자열', () => {
        expect(resolveStartTime({})).toBe('');
        expect(resolveEndTime({})).toBe('');
    });
});
