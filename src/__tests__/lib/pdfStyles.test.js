/**
 * pdfStyles.test.js — PDF 스타일 유틸리티 함수 테스트
 */
import { describe, it, expect } from 'vitest';
import { getPdfStyles, formatDate, formatNumber } from '../../lib/pdfStyles';

describe('getPdfStyles', () => {
    it('CSS 문자열을 반환', () => {
        const css = getPdfStyles();
        expect(typeof css).toBe('string');
        expect(css.length).toBeGreaterThan(100);
    });

    it('A4 landscape 설정 포함', () => {
        expect(getPdfStyles()).toContain('A4 landscape');
    });

    it('log-table 클래스 포함', () => {
        expect(getPdfStyles()).toContain('.log-table');
    });
});

describe('formatDate', () => {
    it('YYYY-MM-DD 형식 유지', () => {
        expect(formatDate('2026-02-27')).toBe('2026-02-27');
    });

    it('빈 값은 - 반환', () => {
        expect(formatDate('')).toBe('-');
        expect(formatDate(null)).toBe('-');
        expect(formatDate(undefined)).toBe('-');
    });

    it('- 문자는 그대로 반환', () => {
        expect(formatDate('-')).toBe('-');
    });

    it('비표준 형식은 그대로 반환', () => {
        expect(formatDate('2026/02/27')).toBe('2026/02/27');
    });
});

describe('formatNumber', () => {
    it('숫자를 로케일 문자열로 변환', () => {
        expect(formatNumber(1000)).toBe('1,000');
        expect(formatNumber(12345.6)).toBe('12,345.6');
    });

    it('문자열 숫자도 변환', () => {
        expect(formatNumber('5000')).toBe('5,000');
    });

    it('빈 값은 빈 문자열 반환', () => {
        expect(formatNumber(null)).toBe('');
        expect(formatNumber(undefined)).toBe('');
        expect(formatNumber('')).toBe('');
    });

    it('0도 정상 변환', () => {
        expect(formatNumber(0)).toBe('0');
    });
});
