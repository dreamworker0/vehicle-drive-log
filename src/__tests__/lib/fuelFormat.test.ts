// 주유·충전량 표기 규칙 단위 테스트.
//
// 계기는 소수점 두세 자리가 끝인데 `<input type="number" step="0.001">`이 타이핑을 막지
// 않아 `33.4545345` 같은 값이 저장되고 목록·리포트에 그대로 늘어졌다(2026-09-05 제보).
// 입력(자르기)과 표시(반올림)를 함께 못박는다 — 한쪽만 고치면 화면과 저장값이 어긋난다.
import { describe, it, expect } from 'vitest';
import { formatFuelAmount, limitFuelDecimals, roundFuelAmount, FUEL_DECIMALS } from '../../lib/fuelFormat';

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

    // 숫자로 못 읽는 값은 자르지 않고 흘려보낸다. 잘라서 '1.2'로 만들면 사용자가 넣은
    // 것과 다른 값을 우리가 지어낸 셈이 되고, 저장 길목(roundFuelAmount)이 어차피 막는다.
    it('점이 여러 개면 손대지 않는다 (붙여넣기)', () => {
        expect(limitFuelDecimals('1.2.3')).toBe('1.2.3');
    });

    // <input type="number">는 지수 표기도 유효한 값으로 넘겨준다. 이걸 소수부로 착각해
    // 자르면 123.456이 1.234가 된다 — 100배 어긋난 값이 조용히 저장된다.
    it('지수 표기는 손대지 않는다 (자르면 100배 어긋난다)', () => {
        expect(limitFuelDecimals('1.23456e2')).toBe('1.23456e2');
        expect(limitFuelDecimals('1e3')).toBe('1e3');
    });

    it('숫자가 아닌 값도 그대로 흘려보낸다', () => {
        expect(limitFuelDecimals('abc')).toBe('abc');
        expect(limitFuelDecimals('-1.2345')).toBe('-1.2345');
    });
});

// 입력 칸만 제한하면 기존 기록 수정에서 샌다 — 폼이 저장된 값을 그대로 프리필하므로
// 주유금액만 고치고 저장하면 긴 주유량이 다시 그대로 쓰인다.
describe('roundFuelAmount — 저장 길목', () => {
    it('저장값을 화면에 보이는 값과 맞춘다', () => {
        expect(roundFuelAmount(33.4545345)).toBe(33.455);
        expect(roundFuelAmount('33.4545345')).toBe(33.455);
    });

    it('이미 짧은 값은 그대로 둔다', () => {
        expect(roundFuelAmount(40.5)).toBe(40.5);
        expect(roundFuelAmount(0)).toBe(0);
    });

    it('숫자로 만들 수 없으면 NaN (호출부의 기존 검증이 빈 값을 막는다)', () => {
        expect(roundFuelAmount('')).toBeNaN();
        expect(roundFuelAmount('abc')).toBeNaN();
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

    it('부동소수 합산 노이즈를 정리한다', () => {
        expect(formatFuelAmount(33.4545345 + 41.0)).toBe('74.455');
        expect(formatFuelAmount(0.1 + 0.2)).toBe('0.3');
    });

    // ⚠️ 천 단위 구분 기호가 없다. PDF 소계처럼 1,000을 넘길 수 있는 자리에는 쓰지 않는다
    // (거기서는 toLocaleString이 맞다 — 이미 3자리로 반올림하면서 구분 기호까지 넣는다).
    it('천 단위 구분 기호를 넣지 않는다', () => {
        expect(formatFuelAmount(1234.5678)).toBe('1234.568');
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
