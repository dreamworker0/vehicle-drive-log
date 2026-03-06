/**
 * timelineUtils.test.js — 타임라인 유틸리티 함수 테스트
 */
import { describe, it, expect } from 'vitest';
import {
    TIMELINE_START, TIMELINE_END, TIMELINE_HOURS,
    SNAP_MINUTES, RANGE_START, RANGE_END, TOTAL_MINUTES,
    timeToMinutes, minutesToTime, snapMinutes, getPercent,
    getGaps, getHourLabels,
} from '../../lib/timelineUtils';

describe('timelineUtils 상수', () => {
    it('타임라인 범위가 06:00~23:00', () => {
        expect(TIMELINE_START).toBe(6);
        expect(TIMELINE_END).toBe(23);
        expect(TIMELINE_HOURS).toBe(17);
    });

    it('분 단위 범위가 올바름', () => {
        expect(RANGE_START).toBe(360); // 6*60
        expect(RANGE_END).toBe(1380); // 23*60
        expect(TOTAL_MINUTES).toBe(1020); // 17*60
    });

    it('스냅 단위가 30분', () => {
        expect(SNAP_MINUTES).toBe(30);
    });
});

describe('timeToMinutes', () => {
    it('기본 변환', () => {
        expect(timeToMinutes('00:00')).toBe(0);
        expect(timeToMinutes('06:00')).toBe(360);
        expect(timeToMinutes('12:30')).toBe(750);
        expect(timeToMinutes('23:00')).toBe(1380);
    });

    it('한 자리 시간도 처리', () => {
        expect(timeToMinutes('9:00')).toBe(540);
    });
});

describe('minutesToTime', () => {
    it('기본 변환', () => {
        expect(minutesToTime(0)).toBe('00:00');
        expect(minutesToTime(360)).toBe('06:00');
        expect(minutesToTime(750)).toBe('12:30');
        expect(minutesToTime(1380)).toBe('23:00');
    });

    it('패딩 처리', () => {
        expect(minutesToTime(65)).toBe('01:05');
    });
});

describe('snapMinutes', () => {
    it('30분 단위로 스냅', () => {
        expect(snapMinutes(0)).toBe(0);
        expect(snapMinutes(14)).toBe(0);
        expect(snapMinutes(15)).toBe(30);
        expect(snapMinutes(29)).toBe(30);
        expect(snapMinutes(45)).toBe(60);
        expect(snapMinutes(60)).toBe(60);
    });
});

describe('getPercent', () => {
    it('타임라인 시작은 0%', () => {
        expect(getPercent(360)).toBe(0);
    });

    it('타임라인 끝은 100%', () => {
        expect(getPercent(1380)).toBe(100);
    });

    it('중간값 계산', () => {
        // 870분 = 14:30 → (870-360)/1020 * 100 = 50%
        expect(getPercent(870)).toBe(50);
    });

    it('범위 밖 값은 클램프', () => {
        expect(getPercent(0)).toBe(0);    // 06:00 미만 → 0%
        expect(getPercent(2000)).toBe(100); // 23:00 초과 → 100%
    });
});

describe('getGaps', () => {
    it('예약이 없으면 전체 범위가 gap', () => {
        const gaps = getGaps([], false, 360);
        expect(gaps).toEqual([{ start: 360, end: 1380 }]);
    });

    it('예약 전후 gap 계산', () => {
        const reservations = [
            { startTime: '09:00', endTime: '10:00' },
            { startTime: '14:00', endTime: '15:00' },
        ];
        const gaps = getGaps(reservations, false, 360);
        expect(gaps).toEqual([
            { start: 360, end: 540 },   // 06:00~09:00
            { start: 600, end: 840 },   // 10:00~14:00
            { start: 900, end: 1380 },  // 15:00~23:00
        ]);
    });

    it('오늘이면 현재 시각 이후만 gap', () => {
        const nowSnapped = 600; // 10:00
        const gaps = getGaps([], true, nowSnapped);
        expect(gaps).toEqual([{ start: 600, end: 1380 }]);
    });

    it('과거 예약은 무시', () => {
        const nowSnapped = 720; // 12:00
        const reservations = [
            { startTime: '07:00', endTime: '08:00' }, // 과거 → 무시
        ];
        const gaps = getGaps(reservations, true, nowSnapped);
        expect(gaps).toEqual([{ start: 720, end: 1380 }]);
    });
});

describe('getHourLabels', () => {
    it('3시간 간격 라벨 생성', () => {
        const labels = getHourLabels();
        expect(labels).toEqual([6, 9, 12, 15, 18, 21]);
    });
});
