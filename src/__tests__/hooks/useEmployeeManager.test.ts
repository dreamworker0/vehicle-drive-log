import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ── Mocks ──
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({
        user: { uid: 'admin1', displayName: '관리자' },
        userData: { organizationId: 'org1', name: '관리자', role: 'admin' },
    }),
}));

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
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

vi.mock('../../lib/firestore', () => ({
    getOrganizationMembers: (...args: unknown[]) => mockGetOrganizationMembers(...args),
    getOrganization: (...args: unknown[]) => mockGetOrganization(...args),
    updateUserRole: (...args: unknown[]) => mockUpdateUserRole(...args),
    removeUserFromOrganization: (...args: unknown[]) => mockRemoveUserFromOrganization(...args),
}));

// Firebase Firestore mock — getDocs (preRegistered 서브컬렉션 조회에 필요)
vi.mock('firebase/firestore', async () => {
    const actual = await vi.importActual('firebase/firestore');
    return {
        ...actual,
        collection: vi.fn(),
        getDocs: vi.fn().mockResolvedValue({ docs: [] }),
    };
});

import useEmployeeManager from '../../hooks/useEmployeeManager';

describe('useEmployeeManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
});
