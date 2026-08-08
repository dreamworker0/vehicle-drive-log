/**
 * numberValidation 단위 테스트
 * 음수 입력 차단 유틸(hooks/utils/numberValidation)을 검증한다.
 */
import { describe, it, expect } from 'vitest';
import { stripNegative, validateNonNegativeFields } from '../../hooks/utils/numberValidation';

describe('stripNegative', () => {
    it('마이너스 부호를 떼어낸다', () => {
        expect(stripNegative('-13')).toBe('13');
    });

    it('소수점 음수도 부호만 떼어낸다', () => {
        expect(stripNegative('-0.5')).toBe('0.5');
    });

    it('부호가 여러 개 붙어도 모두 떼어낸다', () => {
        expect(stripNegative('--7')).toBe('7');
    });

    it('양수는 그대로 둔다', () => {
        expect(stripNegative('45000')).toBe('45000');
    });

    it('빈 값은 그대로 둔다 (지우는 중인 입력을 방해하지 않는다)', () => {
        expect(stripNegative('')).toBe('');
    });

    it('숫자 중간의 하이픈은 건드리지 않는다', () => {
        expect(stripNegative('1-2')).toBe('1-2');
    });
});

describe('validateNonNegativeFields', () => {
    it('0 이상의 값은 모두 통과한다', () => {
        expect(validateNonNegativeFields([
            { label: '주유금액', value: '65000' },
            { label: '주유량', value: '40.5' },
            { label: '주유미터', value: 0 },
        ])).toBeNull();
    });

    it('음수가 있으면 해당 항목 이름이 담긴 메시지를 반환한다', () => {
        expect(validateNonNegativeFields([
            { label: '주유금액', value: '-1000' },
        ])).toBe('주유금액에 음수를 입력할 수 없습니다.');
    });

    it('소수점 음수도 걸러낸다', () => {
        expect(validateNonNegativeFields([
            { label: '주유량', value: '-0.5' },
        ])).toBe('주유량에 음수를 입력할 수 없습니다.');
    });

    it('숫자가 아닌 값은 별도 메시지를 반환한다', () => {
        expect(validateNonNegativeFields([
            { label: '비용', value: 'abc' },
        ])).toBe('비용에 숫자만 입력할 수 있습니다.');
    });

    it('빈 값·null·undefined는 선택 항목으로 보고 통과시킨다', () => {
        expect(validateNonNegativeFields([
            { label: '비용', value: '' },
            { label: '주행거리', value: null },
            { label: '다음 정비 km', value: undefined },
        ])).toBeNull();
    });

    it('앞선 항목이 정상이어도 뒤에 음수가 있으면 걸러낸다', () => {
        expect(validateNonNegativeFields([
            { label: '비용', value: '50000' },
            { label: '주행거리', value: '-1' },
        ])).toBe('주행거리에 음수를 입력할 수 없습니다.');
    });

    it('첫 번째 위반 항목의 메시지만 반환한다', () => {
        expect(validateNonNegativeFields([
            { label: '비용', value: '-1' },
            { label: '주행거리', value: '-2' },
        ])).toBe('비용에 음수를 입력할 수 없습니다.');
    });
});
