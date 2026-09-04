// 주유·충전량 표기 규칙 단위 테스트.
//
// 계기는 소수점 두세 자리가 끝인데 `<input type="number" step="0.001">`이 타이핑을 막지
// 않아 `33.4545345` 같은 값이 저장되고 목록·리포트에 그대로 늘어졌다(2026-09-05 제보).
// 입력(자르기)과 표시(반올림)를 함께 못박는다 — 한쪽만 고치면 화면과 저장값이 어긋난다.
import { describe, it, expect } from 'vitest';
import { formatFuelAmount, limitFuelDecimals, FUEL_DECIMALS } from '../../lib/fuelFormat';

describe('limitFuelDecimals — 입력 중 자릿수 제한', () => {
    it('제보된 값의 초과 자릿수를 잘라낸다', () => {
        expect(limitFuelDecimals('33.4545345')).toBe('33.454');
    });

    it('반올림하지 않고 자른다 (타이핑 중 앞자리가 바뀌면 사용자가 자기 입력을 의심한다)', () => {
        expect(limitFuelDecimals('33.4599')).toBe('33.459');
        expect(limitFuelDecimals('0.9999')).toBe('0.999');
    });

    it('3자리 이하는 그대로 둔다', () => {
        expect(limitFuelDecimals('40.5')).toBe('40.5');
        expect(limitFuelDecimals('40.123')).toBe('40.123');
        expect(limitFuelDecimals('40')).toBe('40');
    });

    it('입력 중 상태를 흘려보낸다 (다음 글자를 계속 칠 수 있어야 한다)', () => {
        expect(limitFuelDecimals('')).toBe('');
        expect(limitFuelDecimals('33.')).toBe('33.');
        expect(limitFuelDecimals('.')).toBe('.');
        expect(limitFuelDecimals('.5')).toBe('.5');
    });

    it('점이 여러 개여도 터지지 않는다 (붙여넣기)', () => {
        expect(limitFuelDecimals('1.2.3')).toBe('1.2');
    });
});

describe('formatFuelAmount — 표시', () => {
    it('이미 저장된 긴 값도 걸러낸다 (입력만 고치면 과거 기록은 계속 길게 나온다)', () => {
        expect(formatFuelAmount(33.4545345)).toBe('33.455'); // 표시는 반올림
    });

    it('불필요한 0을 남기지 않는다', () => {
        expect(formatFuelAmount(40.5)).toBe('40.5');
        expect(formatFuelAmount(40)).toBe('40');
        expect(formatFuelAmount(40.1)).toBe('40.1');
        expect(formatFuelAmount(40.100)).toBe('40.1');
    });

    it('부동소수 합산 노이즈를 정리한다 (PDF 소계가 74.45453450000001로 찍히던 경로)', () => {
        expect(formatFuelAmount(33.4545345 + 41.0)).toBe('74.455');
        expect(formatFuelAmount(0.1 + 0.2)).toBe('0.3');
    });

    it('문자열도 받는다', () => {
        expect(formatFuelAmount('33.4545345')).toBe('33.455');
    });

    it('값이 없거나 숫자가 아니면 빈 문자열 (호출부에서 "-"로 대체하기 쉽게)', () => {
        expect(formatFuelAmount(null)).toBe('');
        expect(formatFuelAmount(undefined)).toBe('');
        expect(formatFuelAmount('')).toBe('');
        expect(formatFuelAmount('abc')).toBe('');
        expect(formatFuelAmount(NaN)).toBe('');
        expect(formatFuelAmount(Infinity)).toBe('');
    });

    it('0은 값이 없는 것과 다르게 0으로 표시한다', () => {
        expect(formatFuelAmount(0)).toBe('0');
    });

    it('자릿수 상수와 실제 동작이 일치한다', () => {
        expect(FUEL_DECIMALS).toBe(3);
        expect(formatFuelAmount(1 / 3)).toBe('0.333');
    });
});
