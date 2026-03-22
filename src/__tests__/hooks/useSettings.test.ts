import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        userData: { organizationId: 'org-1', role: 'admin', name: 'Admin' },
    }),
}));

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

vi.mock('../../lib/firestore', () => ({
    getOrganization: vi.fn().mockResolvedValue({
        name: '테스트 기관',
        adminEmail: 'admin@test.com',
        address: '서울',
        phone: '010-0000-0000',
        approvalLine: [{ title: '담당' }, { title: '팀장' }],
        inviteCode: 'ABC123',
    }),
    updateOrganization: vi.fn().mockResolvedValue(undefined),
    regenerateInviteCode: vi.fn().mockResolvedValue('NEW_CODE'),
    getCustomHolidays: vi.fn().mockResolvedValue([]),
    addCustomHoliday: vi.fn().mockResolvedValue('holiday-1'),
    deleteCustomHoliday: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/holidayApi', () => ({
    fetchPublicHolidays: vi.fn().mockResolvedValue({}),
    groupHolidaysByMonth: vi.fn().mockReturnValue({}),
}));

vi.mock('../../lib/dateUtils', () => ({
    formatDateKr: vi.fn((d: string) => d),
}));

vi.mock('../../hooks/useOrgApplication', () => ({
    formatPhoneNumber: vi.fn((v: string) => v),
}));

import useSettings from '../../hooks/useSettings';

describe('useSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('초기 로딩 후 데이터를 로드한다', async () => {
        const { result } = renderHook(() => useSettings());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.form.name).toBe('테스트 기관');
        expect(result.current.form.adminEmail).toBe('admin@test.com');
    });

    it('orgId가 존재한다', async () => {
        const { result } = renderHook(() => useSettings());

        expect(result.current.orgId).toBe('org-1');
    });

    it('핸들러가 함수로 존재한다', async () => {
        const { result } = renderHook(() => useSettings());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(typeof result.current.handleSave).toBe('function');
        expect(typeof result.current.handleRegenCode).toBe('function');
        expect(typeof result.current.handlePhoneChange).toBe('function');
        expect(typeof result.current.handleAddHoliday).toBe('function');
        expect(typeof result.current.handleDeleteHoliday).toBe('function');
    });

    it('holidayYear 기본값은 현재 연도이다', () => {
        const { result } = renderHook(() => useSettings());

        expect(result.current.holidayYear).toBe(new Date().getFullYear());
    });

    it('formatDate 함수가 존재한다', () => {
        const { result } = renderHook(() => useSettings());

        expect(typeof result.current.formatDate).toBe('function');
    });
});
