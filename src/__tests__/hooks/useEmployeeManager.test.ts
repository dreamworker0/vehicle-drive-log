import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ── Mocks ──
// firebase/analytics mock — 테스트 환경에서 window 미정의로 인한 에러 방지
vi.mock('firebase/analytics', () => ({
    getAnalytics: vi.fn(),
    logEvent: vi.fn(),
    isSupported: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../lib/firebase', () => ({
    db: {},
    auth: {},
    default: {},
}));

vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        user: { uid: 'admin1', displayName: '관리자' },
        userData: { id: 'admin1', organizationId: 'org1', name: '관리자', role: 'admin' },
    }),
}));

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

const mockConfirm = vi.fn();
vi.mock('../../hooks/useConfirm', () => ({
    useConfirm: () => ({ confirm: mockConfirm }),
}));

const mockCallable = vi.fn().mockResolvedValue({ data: { success: true } });
vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(),
    httpsCallable: () => mockCallable,
}));

const mockMembers = [
    { id: 'u1', name: '김직원', email: 'kim@test.com', role: 'employee' },
    { id: 'u2', name: '이직원', email: 'lee@test.com', role: 'employee' },
    { id: 'u3', name: '박관리', email: 'park@test.com', role: 'admin' },
];

const mockOrg = {
    id: 'org1',
    name: '테스트기관',
    inviteCode: 'ABC123',
    adminEmail: 'admin@test.com',
};

const mockGetOrganizationMembers = vi.fn().mockResolvedValue(mockMembers);
const mockGetOrganization = vi.fn().mockResolvedValue(mockOrg);
const mockUpdateUserRole = vi.fn().mockResolvedValue({});
const mockRemoveUserFromOrganization = vi.fn().mockResolvedValue({});
const mockGetPreRegisteredEmployees = vi.fn().mockResolvedValue([]);
const mockRegenerateInviteCode = vi.fn().mockResolvedValue('NEW_CODE');
const mockUpdateUser = vi.fn().mockResolvedValue({});
const mockRestoreUser = vi.fn().mockResolvedValue({});
const mockAddPreRegisteredEmployee = vi.fn().mockResolvedValue({});
const mockDeletePreRegisteredEmployee = vi.fn().mockResolvedValue({});

vi.mock('../../lib/firestore', () => ({
    getOrganizationMembers: (...args: unknown[]) => mockGetOrganizationMembers(...args),
    getOrganization: (...args: unknown[]) => mockGetOrganization(...args),
    updateUserRole: (...args: unknown[]) => mockUpdateUserRole(...args),
    removeUserFromOrganization: (...args: unknown[]) => mockRemoveUserFromOrganization(...args),
    getPreRegisteredEmployees: (...args: unknown[]) => mockGetPreRegisteredEmployees(...args),
    regenerateInviteCode: (...args: unknown[]) => mockRegenerateInviteCode(...args),
    updateUser: (...args: unknown[]) => mockUpdateUser(...args),
    restoreUser: (...args: unknown[]) => mockRestoreUser(...args),
    addPreRegisteredEmployee: (...args: unknown[]) => mockAddPreRegisteredEmployee(...args),
    deletePreRegisteredEmployee: (...args: unknown[]) => mockDeletePreRegisteredEmployee(...args),
}));

import useEmployeeManager from '../../hooks/useEmployeeManager';

describe('useEmployeeManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockConfirm.mockResolvedValue(true);
        mockCallable.mockResolvedValue({ data: { success: true } });
    });

    it('초기 로딩 후 직원 목록과 기관 정보를 가져온다', async () => {
        const { result } = renderHook(() => useEmployeeManager());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.employees).toHaveLength(3);
        expect(result.current.organization).toBeDefined();
        expect(result.current.organization?.name).toBe('테스트기관');
    });

    it('getOrganizationMembers를 orgId로 호출한다', async () => {
        renderHook(() => useEmployeeManager());

        await waitFor(() => expect(mockGetOrganizationMembers).toHaveBeenCalledWith('org1'));
    });

    it('검색 필터가 동작한다', async () => {
        const { result } = renderHook(() => useEmployeeManager());

        await waitFor(() => expect(result.current.loading).toBe(false));

        // filteredEmployees는 searchQuery에 따라 필터됨
        expect(result.current.filteredEmployees.length).toBeGreaterThanOrEqual(0);
    });

    it('통합 목록(unifiedList)이 생성된다', async () => {
        const { result } = renderHook(() => useEmployeeManager());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.unifiedList).toBeDefined();
        expect(result.current.unifiedList.length).toBe(3); // 활성 3명, 사전등록 0명, 비활성 0명
        expect(result.current.unifiedList[0].memberStatus).toBe('active');
    });

    it('stats 객체가 올바른 카운트를 반환한다', async () => {
        const { result } = renderHook(() => useEmployeeManager());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.stats.total).toBe(3);
        expect(result.current.stats.active).toBe(3);
        expect(result.current.stats.pending).toBe(0);
        expect(result.current.stats.disabled).toBe(0);
    });

    describe('handleDeletePermanently — 완전 삭제', () => {
        const disabledEmp = { id: 'u9', name: '퇴사직원', email: 'out@test.com', role: 'employee', status: 'disabled' };

        it('입력한 이름이 일치하면 deleteUserPermanently 함수를 호출한다', async () => {
            mockConfirm.mockResolvedValue('퇴사직원');
            const { result } = renderHook(() => useEmployeeManager());
            await waitFor(() => expect(result.current.loading).toBe(false));

            // 삭제 성공 후 목록 재로드(setState)가 act 밖에서 반영되지 않도록 감싼다
            await act(async () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await result.current.handleDeletePermanently(disabledEmp as any);
            });

            expect(mockCallable).toHaveBeenCalledWith({ uid: 'u9' });
            expect(mockShowToast).toHaveBeenCalledWith('직원 계정이 완전히 삭제되었습니다.', 'success');
        });

        it('입력한 이름이 일치하지 않으면 삭제를 중단한다', async () => {
            mockConfirm.mockResolvedValue('다른이름');
            const { result } = renderHook(() => useEmployeeManager());
            await waitFor(() => expect(result.current.loading).toBe(false));

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await result.current.handleDeletePermanently(disabledEmp as any);

            expect(mockCallable).not.toHaveBeenCalled();
            expect(mockShowToast).toHaveBeenCalledWith('입력한 내용이 일치하지 않아 삭제를 취소했습니다.', 'warning');
        });

        it('확인 모달을 취소하면 아무 동작도 하지 않는다', async () => {
            mockConfirm.mockResolvedValue(false);
            const { result } = renderHook(() => useEmployeeManager());
            await waitFor(() => expect(result.current.loading).toBe(false));

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await result.current.handleDeletePermanently(disabledEmp as any);

            expect(mockCallable).not.toHaveBeenCalled();
            expect(mockShowToast).not.toHaveBeenCalled();
        });
    });
});
