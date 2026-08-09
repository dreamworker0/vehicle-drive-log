/**
 * reservationPatternCalc — 예약 패턴 분석 순수 계산 테스트
 *
 * 이 모듈의 출력이 곧 사용자에게 보이는 "추천 예약"이다. 잘못 집계되면 엉뚱한 요일·시간·차량이
 * 추천되는데, 화면만 보고는 계산이 틀렸는지 데이터가 그런 건지 구분되지 않는다.
 * 날짜 함수는 `vi.setSystemTime`으로 고정한다 — TZ는 vitest.config.js에서 Asia/Seoul로 고정돼 있다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    timeToMinutes,
    minutesToTime,
    getNextDateForWeekday,
    getNextWeekday,
    advanceDateByWeek,
    isTimeConflict,
    extractTopDestinations,
    buildVehicleFrequency,
    aggregatePatterns,
    selectTopPatterns,
    getMostFrequentTime,
    calcAverageDuration,
    getMostFrequentVehicle,
    type ReservationInput,
} from '../../hooks/utils/reservationPatternCalc';

describe('timeToMinutes / minutesToTime', () => {
    it('HH:MM을 분으로 바꾼다', () => {
        expect(timeToMinutes('09:30')).toBe(570);
        expect(timeToMinutes('00:00')).toBe(0);
        expect(timeToMinutes('23:59')).toBe(1439);
    });

    it('빈 문자열·깨진 값은 0으로 떨어진다', () => {
        expect(timeToMinutes('')).toBe(0);
        expect(timeToMinutes('abc')).toBe(0);
        expect(timeToMinutes(':')).toBe(0);
    });

    it('분을 HH:MM으로 되돌린다', () => {
        expect(minutesToTime(570)).toBe('09:30');
        expect(minutesToTime(0)).toBe('00:00');
        expect(minutesToTime(1439)).toBe('23:59');
    });

    it('24시를 넘어가면 23시로 눌러 담는다 — 날짜가 넘어간 시각을 만들지 않는다', () => {
        expect(minutesToTime(1500)).toBe('23:00');
        expect(minutesToTime(24 * 60)).toBe('23:00');
    });
});

describe('날짜 계산', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // 2026-03-05는 목요일(getDay()===4)
        vi.setSystemTime(new Date('2026-03-05T10:00:00+09:00'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('다음 해당 요일은 항상 오늘 이후다', () => {
        expect(getNextDateForWeekday(5)).toBe('2026-03-06'); // 금
        expect(getNextDateForWeekday(1)).toBe('2026-03-09'); // 다음 주 월
    });

    it('오늘과 같은 요일을 물으면 다음 주로 넘어간다', () => {
        expect(getNextDateForWeekday(4)).toBe('2026-03-12');
    });

    it('내일이 평일이면 그대로 내일을 쓴다', () => {
        expect(getNextWeekday()).toEqual({ dateStr: '2026-03-06', weekday: 5 });
    });

    it('내일이 토요일이면 월요일로 민다', () => {
        vi.setSystemTime(new Date('2026-03-06T10:00:00+09:00')); // 금 → 내일 토
        expect(getNextWeekday()).toEqual({ dateStr: '2026-03-09', weekday: 1 });
    });

    it('내일이 일요일이면 월요일로 민다', () => {
        vi.setSystemTime(new Date('2026-03-07T10:00:00+09:00')); // 토 → 내일 일
        expect(getNextWeekday()).toEqual({ dateStr: '2026-03-09', weekday: 1 });
    });

    it('7일 뒤로 옮길 때 월을 넘겨도 맞는다', () => {
        expect(advanceDateByWeek('2026-03-05')).toBe('2026-03-12');
        expect(advanceDateByWeek('2026-03-28')).toBe('2026-04-04');
        expect(advanceDateByWeek('2026-12-28')).toBe('2027-01-04');
    });
});

describe('isTimeConflict', () => {
    it('겹치면 true', () => {
        expect(isTimeConflict('09:00', '11:00', '10:00', '12:00')).toBe(true);
        expect(isTimeConflict('09:00', '18:00', '10:00', '11:00')).toBe(true);
    });

    it('맞닿기만 하면 겹치지 않는다', () => {
        expect(isTimeConflict('09:00', '11:00', '11:00', '12:00')).toBe(false);
        expect(isTimeConflict('11:00', '12:00', '09:00', '11:00')).toBe(false);
    });
});

describe('extractTopDestinations', () => {
    const res = (destination: string): ReservationInput => ({
        date: '2026-03-05', startTime: '09:00', vehicleId: 'v1', destination,
    });

    it('쉼표로 나뉜 목적지를 각각 세어 빈도순으로 돌려준다', () => {
        expect(extractTopDestinations([
            res('시청, 복지관'),
            res('복지관'),
            res('복지관, 병원'),
            res('병원'),
        ])).toEqual(['복지관', '병원', '시청']);
    });

    it('빈도가 같으면 이름순으로 갈라 결과가 흔들리지 않게 한다', () => {
        expect(extractTopDestinations([res('나'), res('가')])).toEqual(['가', '나']);
    });

    it('topN으로 개수를 자른다', () => {
        expect(extractTopDestinations([res('가'), res('나'), res('다')], 2)).toHaveLength(2);
    });

    it('목적지가 비었거나 공백뿐이면 세지 않는다', () => {
        expect(extractTopDestinations([res(''), res('  ,  ')])).toEqual([]);
    });
});

describe('buildVehicleFrequency', () => {
    it('차량별 사용 횟수를 센다', () => {
        const map = buildVehicleFrequency([
            { date: '2026-03-05', startTime: '09:00', vehicleId: 'v1' },
            { date: '2026-03-06', startTime: '09:00', vehicleId: 'v1' },
            { date: '2026-03-07', startTime: '09:00', vehicleId: 'v2' },
        ]);
        expect(map.get('v1')).toBe(2);
        expect(map.get('v2')).toBe(1);
    });

    it('vehicleId가 비면 세지 않는다', () => {
        expect(buildVehicleFrequency([{ date: '2026-03-05', startTime: '09:00', vehicleId: '' }]).size).toBe(0);
    });
});

describe('aggregatePatterns', () => {
    /** 2026-03-05 = 목(4), 2026-03-12 = 목(4) */
    const weekly: ReservationInput[] = [
        { date: '2026-03-05', startTime: '09:00', endTime: '11:00', vehicleId: 'v1', destination: '복지관' },
        { date: '2026-03-12', startTime: '09:00', endTime: '11:00', vehicleId: 'v1', destination: '복지관' },
    ];

    it('같은 요일·시간·목적지를 주간 패턴으로 누적한다', () => {
        const map = aggregatePatterns(weekly);
        const w = map.get('W_4_09:00_복지관')!;
        expect(w.count).toBe(2);
        expect(w.score).toBeCloseTo(2.0);
        expect(w.type).toBe('weekly');
        expect(w.targetWeekday).toBe(4);
        expect(w.times).toEqual(['09:00']);       // 같은 시간은 한 번만 담는다
        expect(w.vehicles).toEqual(['v1', 'v1']); // 최빈 차량 계산용이라 중복을 남긴다
        expect(w.durations).toEqual([120, 120]);
    });

    it('목적지가 있으면 목적지 복합 패턴까지 네 종류를 만든다', () => {
        const map = aggregatePatterns([weekly[0]]);
        expect([...map.keys()].sort()).toEqual([
            'DD_복지관', 'DW_4_복지관', 'D_09:00_복지관', 'W_4_09:00_복지관',
        ].sort());
    });

    it('목적지가 없으면 목적지 복합 패턴을 만들지 않는다', () => {
        const map = aggregatePatterns([
            { date: '2026-03-05', startTime: '09:00', vehicleId: 'v1' },
        ]);
        expect([...map.keys()].sort()).toEqual(['D_09:00_EMPTY_DEST', 'W_4_09:00_EMPTY_DEST']);
    });

    it('종료 시각이 없거나 거꾸로면 기본 60분으로 본다', () => {
        const map = aggregatePatterns([
            { date: '2026-03-05', startTime: '09:00', vehicleId: 'v1' },
            { date: '2026-03-12', startTime: '09:00', endTime: '08:00', vehicleId: 'v1' },
        ]);
        expect(map.get('W_4_09:00_EMPTY_DEST')!.durations).toEqual([60, 60]);
    });

    it('날짜·시작시각·차량 중 하나라도 비면 건너뛴다', () => {
        const map = aggregatePatterns([
            { date: '', startTime: '09:00', vehicleId: 'v1' },
            { date: '2026-03-05', startTime: '', vehicleId: 'v1' },
            { date: '2026-03-05', startTime: '09:00', vehicleId: '' },
        ]);
        expect(map.size).toBe(0);
    });
});

describe('selectTopPatterns', () => {
    const map = aggregatePatterns([
        { date: '2026-03-05', startTime: '09:00', vehicleId: 'v1', destination: '복지관' },
        { date: '2026-03-12', startTime: '09:00', vehicleId: 'v1', destination: '복지관' },
    ]);

    it('예약이 적으면(≤15) 2회부터 패턴으로 인정한다', () => {
        expect(selectTopPatterns(map, 10).length).toBeGreaterThan(0);
    });

    it('예약이 많으면(>15) 3회 이상만 인정한다 — 우연한 반복을 추천하지 않는다', () => {
        expect(selectTopPatterns(map, 20)).toEqual([]);
    });

    it('점수 높은 순으로 topN개만 돌려준다', () => {
        const top = selectTopPatterns(map, 10, 2);
        expect(top).toHaveLength(2);
        expect(top[0].score).toBeGreaterThanOrEqual(top[1].score);
        expect(top[0].type).toBe('weekly'); // 가중치 1.0이 가장 높다
    });
});

describe('최빈값 / 평균 계산', () => {
    it('가장 자주 쓴 시간을 고르고, 없으면 fallback', () => {
        expect(getMostFrequentTime(['09:00', '10:00', '09:00'], '13:00')).toBe('09:00');
        expect(getMostFrequentTime([], '13:00')).toBe('13:00');
    });

    it('동률이면 먼저 등장한 시간을 유지한다', () => {
        expect(getMostFrequentTime(['10:00', '09:00'], '13:00')).toBe('10:00');
    });

    it('평균 소요시간 — 비었으면 60분', () => {
        expect(calcAverageDuration([60, 120])).toBe(90);
        expect(calcAverageDuration([])).toBe(60);
    });

    it('가장 자주 쓴 차량을 고르고, 없으면 빈 문자열', () => {
        expect(getMostFrequentVehicle(['v1', 'v2', 'v2'])).toBe('v2');
        expect(getMostFrequentVehicle([])).toBe('');
    });
});
