import { describe, it, expect, beforeEach } from 'vitest';
import { rememberAdminArea, adminHomePath } from '../../lib/lastArea';

describe('lastArea — 기관 관리자가 마지막에 쓴 화면', () => {
    beforeEach(() => localStorage.clear());

    it('직원 화면을 기억하면 /employee, 관리자 화면으로 돌아오면 다시 /admin', () => {
        rememberAdminArea('a1', 'employee');
        expect(adminHomePath('a1')).toBe('/employee');
        rememberAdminArea('a1', 'admin');
        expect(adminHomePath('a1')).toBe('/admin');
    });

    it('기록이 없거나 다른 계정 기록이면 /admin', () => {
        expect(adminHomePath('a1')).toBe('/admin');
        rememberAdminArea('a2', 'employee');
        expect(adminHomePath('a1')).toBe('/admin');
    });

    it('uid가 없으면 기록하지도 따르지도 않는다', () => {
        rememberAdminArea(null, 'employee');
        expect(localStorage.getItem('admin-last-area')).toBeNull();
        expect(adminHomePath(undefined)).toBe('/admin');
    });

    it('깨진 값이 남아 있어도 /admin으로 연다', () => {
        localStorage.setItem('admin-last-area', '{not json');
        expect(adminHomePath('a1')).toBe('/admin');
    });
});
