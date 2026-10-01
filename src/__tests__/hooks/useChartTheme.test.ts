/**
 * useChartTheme — 차트 색과 금액 눈금
 */
import { describe, it, expect } from 'vitest';
import { chartTheme, formatWonTick } from '../../hooks/useChartTheme';

describe('formatWonTick — 금액 축 눈금', () => {
    it('1만 원 미만은 원 그대로 — 예전에는 전부 "0만"이었다', () => {
        expect(formatWonTick(0)).toBe('0');
        expect(formatWonTick(5000)).toBe('5,000');
        expect(formatWonTick(9999)).toBe('9,999');
    });

    it('1만 원 이상은 만 단위, 소수 한 자리까지', () => {
        expect(formatWonTick(10000)).toBe('1만');
        expect(formatWonTick(15000)).toBe('1.5만');
        expect(formatWonTick(1234567)).toBe('123.5만');
    });

    it('숫자가 아니면 빈 문자열', () => {
        expect(formatWonTick(Number.NaN)).toBe('');
    });
});

describe('chartTheme — 다크에서 밝은 격자·흰 툴팁이 튀지 않는다', () => {
    it('라이트와 다크의 격자·배경·툴팁 배경이 다르다', () => {
        const light = chartTheme(false);
        const dark = chartTheme(true);
        expect(light.grid).not.toBe(dark.grid);
        expect(light.surface).toBe('#ffffff');
        expect(dark.surface).not.toBe('#ffffff');
        expect(dark.tooltip.contentStyle.backgroundColor).not.toBe('#ffffff');
    });
});
