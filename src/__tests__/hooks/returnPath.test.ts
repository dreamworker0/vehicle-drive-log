import { describe, it, expect } from 'vitest';
import { safeAdminReturnPath } from '@/hooks/driveLogForm/returnPath';

// 화면 이동 상태로 들어온 값이라 그대로 쓰지 않는다 — 앱 안 관리자 경로만 받는다
describe('safeAdminReturnPath', () => {
    it('관리자 화면 경로(쿼리 포함)는 그대로 쓴다', () => {
        expect(safeAdminReturnPath('/admin/drive-logs?vehicle=v1&from=2026-10-01')).toBe('/admin/drive-logs?vehicle=v1&from=2026-10-01');
    });

    it.each([
        ['외부 주소', 'https://evil.example/admin'],
        ['프로토콜 상대 주소', '//evil.example/admin'],
        ['직원 화면', '/employee/my-records'],
        ['역슬래시', String.raw`/admin\..\x`],
        ['문자열이 아님', { pathname: '/admin' }],
        ['없음', undefined],
    ])('%s는 받지 않는다', (_label, raw) => {
        expect(safeAdminReturnPath(raw)).toBeNull();
    });
});
