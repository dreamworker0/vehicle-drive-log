import { describe, it, expect } from 'vitest';
import { isVehicleBlocked } from '../../lib/vehicleUtils';
import { toLocalDateStr } from '../../lib/dateUtils';
import { VehicleMaintenance } from '../../types/vehicle';

describe('vehicleUtils', () => {
    describe('isVehicleBlocked', () => {
        it('maintenance 정보가 null 또는 undefined이면 false를 반환한다', () => {
            expect(isVehicleBlocked(null)).toBe(false);
            expect(isVehicleBlocked(undefined)).toBe(false);
        });

        it('isBlocked 플래그가 false이면 false를 반환한다', () => {
            expect(isVehicleBlocked({ isBlocked: false } as unknown as VehicleMaintenance)).toBe(false);
            expect(isVehicleBlocked({ isBlocked: false, endDate: '2026-12-31' } as unknown as VehicleMaintenance)).toBe(false);
        });

        it('isBlocked가 true이고 endDate가 명시되지 않은 경우 무기한 차단 상태(true)로 간주한다', () => {
            expect(isVehicleBlocked({ isBlocked: true } as unknown as VehicleMaintenance)).toBe(true);
            expect(isVehicleBlocked({ isBlocked: true, endDate: '' } as unknown as VehicleMaintenance)).toBe(true);
        });

        it('isBlocked가 true이고 endDate가 오늘 이후인 경우 차단 상태(true)이다', () => {
            const tomorrow = toLocalDateStr(new Date(Date.now() + 86400000));
            expect(isVehicleBlocked({ isBlocked: true, endDate: tomorrow } as unknown as VehicleMaintenance)).toBe(true);
        });

        it('isBlocked가 true이고 endDate가 오늘인 경우 당일까지 차단이므로 차단 상태(true)이다', () => {
            const today = toLocalDateStr();
            expect(isVehicleBlocked({ isBlocked: true, endDate: today } as unknown as VehicleMaintenance)).toBe(true);
        });

        it('isBlocked가 true이고 endDate가 어제인 경우 자동으로 차단이 해제되어 false를 반환해야 한다', () => {
            const yesterday = toLocalDateStr(new Date(Date.now() - 86400000));
            expect(isVehicleBlocked({ isBlocked: true, endDate: yesterday } as unknown as VehicleMaintenance)).toBe(false);
        });
    });
});
