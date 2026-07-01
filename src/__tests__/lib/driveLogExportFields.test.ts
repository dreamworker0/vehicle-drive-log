/**
 * driveLogExportFields 테스트 — Excel/PDF 내보내기 공용 필드 해석 헬퍼
 */
import { describe, it, expect } from 'vitest';
import {
    resolveStartKm, resolveEndKm, resolveDistance, resolveDateStr, resolveStartTime, resolveEndTime,
    attachFuelSummary,
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

type FuelTestLog = {
    vehicleId?: string;
    date?: string;
    timestamp?: { toDate: () => Date };
    startTime?: string;
    fuelSummary?: string;
};

describe('attachFuelSummary', () => {
    it('같은 차량+날짜의 주유를 합산해 첫 운행(출발 시각 오름차순) 행에만 부착한다', () => {
        const logs: FuelTestLog[] = [
            { vehicleId: 'v1', date: '2026-03-05', startTime: '13:00' },
            { vehicleId: 'v1', date: '2026-03-05', startTime: '09:00' },
            { vehicleId: 'v1', date: '2026-03-05', startTime: '11:00' },
        ];
        attachFuelSummary(logs, [
            { vehicleId: 'v1', date: '2026-03-05', fuelType: 'gasoline', fuelAmount: 30, fuelCost: 45000 },
            { vehicleId: 'v1', date: '2026-03-05', fuelType: 'gasoline', fuelAmount: 5.5, fuelCost: 5000 },
        ]);
        // 09:00 행에만 합산 부착 (45000+5000=50000, 30+5.5=35.5)
        expect(logs[1].fuelSummary).toBe('50,000(35.5L)');
        expect(logs[0].fuelSummary).toBeUndefined();
        expect(logs[2].fuelSummary).toBeUndefined();
    });

    it('연료 유형별 단위를 표기한다 (electric→kWh, hydrogen→kg)', () => {
        const ev: FuelTestLog[] = [{ vehicleId: 'v1', date: '2026-03-05', startTime: '09:00' }];
        attachFuelSummary(ev, [{ vehicleId: 'v1', date: '2026-03-05', fuelType: 'electric', fuelAmount: 40, fuelCost: 12000 }]);
        expect(ev[0].fuelSummary).toBe('12,000(40kWh)');

        const h2: FuelTestLog[] = [{ vehicleId: 'v1', date: '2026-03-05', startTime: '09:00' }];
        attachFuelSummary(h2, [{ vehicleId: 'v1', date: '2026-03-05', fuelType: 'hydrogen', fuelAmount: 4, fuelCost: 33000 }]);
        expect(h2[0].fuelSummary).toBe('33,000(4kg)');
    });

    it('date 대신 timestamp를 쓰는 운행일지도 주유 date와 매칭한다', () => {
        const d = new Date('2026-03-05T09:00:00');
        const logs: FuelTestLog[] = [{ vehicleId: 'v1', timestamp: { toDate: () => d }, startTime: '09:00' }];
        attachFuelSummary(logs, [{ vehicleId: 'v1', date: toLocalDateStr(d), fuelType: 'gasoline', fuelAmount: 10, fuelCost: 15000 }]);
        expect(logs[0].fuelSummary).toBe('15,000(10L)');
    });

    it('주유 없는 차량+날짜, 다른 차량은 부착하지 않는다', () => {
        const logs: FuelTestLog[] = [
            { vehicleId: 'v1', date: '2026-03-05', startTime: '09:00' },
            { vehicleId: 'v2', date: '2026-03-05', startTime: '09:00' },
        ];
        attachFuelSummary(logs, [{ vehicleId: 'v1', date: '2026-03-06', fuelType: 'gasoline', fuelAmount: 10, fuelCost: 15000 }]);
        expect(logs[0].fuelSummary).toBeUndefined();
        expect(logs[1].fuelSummary).toBeUndefined();
    });

    it('주유 기록이 비면 원본을 그대로 반환한다', () => {
        const logs: FuelTestLog[] = [{ vehicleId: 'v1', date: '2026-03-05', startTime: '09:00' }];
        expect(attachFuelSummary(logs, [])).toBe(logs);
        expect(logs[0].fuelSummary).toBeUndefined();
    });
});
