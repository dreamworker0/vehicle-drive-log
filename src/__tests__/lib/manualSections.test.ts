/**
 * manualSections.test.js — 사용 설명서 데이터 구조 테스트
 */
import { describe, it, expect } from 'vitest';
import { ADMIN_SECTIONS, EMPLOYEE_SECTIONS } from '../../lib/manualSections';

describe('ADMIN_SECTIONS', () => {
    it('배열이어야 함', () => {
        expect(Array.isArray(ADMIN_SECTIONS)).toBe(true);
    });

    it('최소 5개 이상 섹션', () => {
        expect(ADMIN_SECTIONS.length).toBeGreaterThanOrEqual(5);
    });

    it('각 섹션에 title과 content 존재', () => {
        ADMIN_SECTIONS.forEach(section => {
            expect(section).toHaveProperty('title');
            expect(section).toHaveProperty('content');
            expect(typeof section.title).toBe('string');
            expect(Array.isArray(section.content)).toBe(true);
            expect(section.content.length).toBeGreaterThan(0);
        });
    });

    it('content 항목에 text 속성 필수', () => {
        ADMIN_SECTIONS.forEach(section => {
            section.content.forEach(item => {
                expect(item).toHaveProperty('text');
                expect(typeof item.text).toBe('string');
            });
        });
    });

    it('type은 허용된 값만 사용', () => {
        const allowedTypes = ['tip', 'warning', 'step', undefined];
        ADMIN_SECTIONS.forEach(section => {
            section.content.forEach(item => {
                expect(allowedTypes).toContain(item.type);
            });
        });
    });
});

describe('EMPLOYEE_SECTIONS', () => {
    it('배열이어야 함', () => {
        expect(Array.isArray(EMPLOYEE_SECTIONS)).toBe(true);
    });

    it('최소 5개 이상 섹션', () => {
        expect(EMPLOYEE_SECTIONS.length).toBeGreaterThanOrEqual(5);
    });

    it('각 섹션에 title과 content 존재', () => {
        EMPLOYEE_SECTIONS.forEach(section => {
            expect(section).toHaveProperty('title');
            expect(section).toHaveProperty('content');
            expect(Array.isArray(section.content)).toBe(true);
        });
    });
});
