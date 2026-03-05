/**
 * useOrgApplication.test.js — formatPhoneNumber 유틸 함수 테스트
 */
import { describe, it, expect } from 'vitest';
import { formatPhoneNumber } from '../../hooks/useOrgApplication';

describe('formatPhoneNumber', () => {
    it('숫자만 추출하여 포맷', () => {
        expect(formatPhoneNumber('01012345678')).toBe('010-1234-5678');
    });

    it('3자리 이하는 그대로', () => {
        expect(formatPhoneNumber('010')).toBe('010');
        expect(formatPhoneNumber('01')).toBe('01');
    });

    it('4~7자리는 앞 3자리-나머지', () => {
        expect(formatPhoneNumber('0101234')).toBe('010-1234');
    });

    it('비숫자 문자 제거', () => {
        expect(formatPhoneNumber('010-1234-5678')).toBe('010-1234-5678');
        expect(formatPhoneNumber('abc010def1234ghi5678')).toBe('010-1234-5678');
    });

    it('11자리 초과는 잘림', () => {
        expect(formatPhoneNumber('010123456789999')).toBe('010-1234-5678');
    });

    it('빈 문자열', () => {
        expect(formatPhoneNumber('')).toBe('');
    });
});
