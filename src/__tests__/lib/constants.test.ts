/**
 * constants.js 테스트
 */
import { describe, it, expect } from 'vitest';
import { VEHICLE_TYPE_ICONS, VEHICLE_COLORS, getVehicleColor } from '../../lib/constants';

describe('constants', () => {
    describe('VEHICLE_TYPE_ICONS', () => {
        it('모든 차종에 이모지가 정의되어 있어야 한다', () => {
            expect(VEHICLE_TYPE_ICONS).toHaveProperty('compact');
            expect(VEHICLE_TYPE_ICONS).toHaveProperty('sedan');
            expect(VEHICLE_TYPE_ICONS).toHaveProperty('van');
            expect(VEHICLE_TYPE_ICONS).toHaveProperty('bus');
        });
    });

    describe('VEHICLE_COLORS', () => {
        it('색상 배열이 10개여야 한다', () => {
            expect(VEHICLE_COLORS).toHaveLength(10);
        });

        it('모든 색상이 bg- 접두사를 가져야 한다', () => {
            VEHICLE_COLORS.forEach(color => {
                expect(color).toMatch(/^bg-/);
            });
        });
    });

    describe('getVehicleColor', () => {
        it('동일 ID는 항상 동일 색상을 반환해야 한다', () => {
            const color1 = getVehicleColor('vehicle-abc-123');
            const color2 = getVehicleColor('vehicle-abc-123');
            expect(color1).toBe(color2);
        });

        it('반환된 색상이 VEHICLE_COLORS에 포함되어야 한다', () => {
            const color = getVehicleColor('test-id');
            expect(VEHICLE_COLORS).toContain(color);
        });

        it('서로 다른 ID는 색상이 분산되어야 한다', () => {
            const colors = new Set();
            for (let i = 0; i < 20; i++) {
                colors.add(getVehicleColor(`vehicle-${i}`));
            }
            // 20개 ID에서 최소 3개 이상 다른 색상이 나와야 함 (분산 검증)
            expect(colors.size).toBeGreaterThanOrEqual(3);
        });

        it('빈 문자열 ID에도 색상을 반환해야 한다', () => {
            const color = getVehicleColor('');
            expect(VEHICLE_COLORS).toContain(color);
        });
    });
});
