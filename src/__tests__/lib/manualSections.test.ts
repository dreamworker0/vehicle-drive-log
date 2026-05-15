/**
 * manualSections.test.ts — 사용 설명서 JSON 데이터 구조 테스트
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { loadManualSections } from '../../lib/manualSections';
import manualData from '../../../public/data/manualSections.json';

// fetch mock: JSON 데이터를 직접 반환
beforeAll(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => manualData,
    });
});

describe('ADMIN_SECTIONS (via loadManualSections)', () => {
    it('배열이어야 함', async () => {
        const { adminSections } = await loadManualSections();
        expect(Array.isArray(adminSections)).toBe(true);
    });

    it('최소 5개 이상 섹션', async () => {
        const { adminSections } = await loadManualSections();
        expect(adminSections.length).toBeGreaterThanOrEqual(5);
    });

    it('각 섹션에 title과 content 존재', async () => {
        const { adminSections } = await loadManualSections();
        adminSections.forEach(section => {
            expect(section).toHaveProperty('title');
            expect(section).toHaveProperty('content');
            expect(typeof section.title).toBe('string');
            expect(Array.isArray(section.content)).toBe(true);
            expect(section.content.length).toBeGreaterThan(0);
        });
    });

    it('content 항목에 text 속성 필수', async () => {
        const { adminSections } = await loadManualSections();
        adminSections.forEach(section => {
            section.content.forEach(item => {
                expect(item).toHaveProperty('text');
                expect(typeof item.text).toBe('string');
            });
        });
    });

    it('type은 허용된 값만 사용', async () => {
        const allowedTypes = ['tip', 'warning', 'step', 'link', undefined];
        const { adminSections } = await loadManualSections();
        adminSections.forEach(section => {
            section.content.forEach(item => {
                expect(allowedTypes).toContain(item.type);
            });
        });
    });
});

describe('EMPLOYEE_SECTIONS (via loadManualSections)', () => {
    it('배열이어야 함', async () => {
        const { employeeSections } = await loadManualSections();
        expect(Array.isArray(employeeSections)).toBe(true);
    });

    it('최소 5개 이상 섹션', async () => {
        const { employeeSections } = await loadManualSections();
        expect(employeeSections.length).toBeGreaterThanOrEqual(5);
    });

    it('각 섹션에 title과 content 존재', async () => {
        const { employeeSections } = await loadManualSections();
        employeeSections.forEach(section => {
            expect(section).toHaveProperty('title');
            expect(section).toHaveProperty('content');
            expect(Array.isArray(section.content)).toBe(true);
        });
    });
});
