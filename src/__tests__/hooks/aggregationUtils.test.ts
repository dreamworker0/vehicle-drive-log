/**
 * aggregationUtils — 통계·분석 화면이 함께 쓰는 공통 규칙
 */
import { describe, it, expect } from 'vitest';
import { logDistance } from '../../hooks/utils/aggregationUtils';

describe('logDistance — 두 화면(통계·분석)과 엑셀이 같은 거리를 쓴다', () => {
    it('저장된 distance가 있으면 그것이 정본이다 (다일 운행·정정 기록)', () => {
        expect(logDistance({ distance: 60, startKm: 100, endKm: 150 })).toBe(60);
    });

    it('distance가 없으면 도착 − 출발', () => {
        expect(logDistance({ startKm: 100, endKm: 150 })).toBe(50);
    });

    it('음수·NaN은 0 — 계기판 역전 기록이 합계를 깎지 않는다 (야간 집계와 같은 규칙)', () => {
        expect(logDistance({ startKm: 500, endKm: 400 })).toBe(0);
        expect(logDistance({ distance: -30 })).toBe(0);
        expect(logDistance({ distance: Number.NaN })).toBe(0);
        expect(logDistance({})).toBe(0);
    });
});
