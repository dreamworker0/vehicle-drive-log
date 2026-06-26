/**
 * editKmRange — 운행일지 수정 모드 km 범위 검증
 */
import { describe, it, expect } from 'vitest';
import { validateEditKmRange } from '../../hooks/driveLogForm/editKmRange';
import type { DriveLogForm } from '../../hooks/driveLogForm/types';
import type { DriveLog } from '../../types/driveLog';

const form = (startKm: string, endKm: string) =>
    ({ startKm, endKm } as unknown as DriveLogForm);
const log = (startKm: number, endKm: number) =>
    ({ id: 'x', startKm, endKm } as unknown as DriveLog);

describe('validateEditKmRange', () => {
    it('인접 기록이 없으면 항상 통과(null)', () => {
        expect(validateEditKmRange(form('100', '200'), null, null)).toBeNull();
    });

    it('출발 km가 직전 기록 출발 이상이면 통과', () => {
        expect(validateEditKmRange(form('150', '200'), log(100, 150), null)).toBeNull();
    });

    it('출발 km가 직전 기록 출발보다 작으면 위반 메시지', () => {
        const msg = validateEditKmRange(form('90', '200'), log(100, 150), null);
        expect(msg).toContain('출발 km는 직전 기록의 출발');
    });

    it('도착 km가 직후 기록 도착 이하이면 통과', () => {
        expect(validateEditKmRange(form('100', '250'), null, log(250, 300))).toBeNull();
    });

    it('도착 km가 직후 기록 도착보다 크면 위반 메시지', () => {
        const msg = validateEditKmRange(form('100', '350'), null, log(250, 300));
        expect(msg).toContain('도착 km는 직후 기록의 도착');
    });

    it('경계값(같은 값)은 통과', () => {
        expect(validateEditKmRange(form('100', '300'), log(100, 150), log(250, 300))).toBeNull();
    });
});
