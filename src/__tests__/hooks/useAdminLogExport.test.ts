import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * useAdminLogExport — 관리자 로그 화면 공통 내보내기 훅.
 * 세 화면(주유/정비/하이패스)에서 추출하면서, 흩어져 있던 결재란 계산 3분기와
 * 다운로드 실패 시 에러 토스트 처리를 단위 테스트로 고정한다.
 */

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => ({ userData: { organizationId: 'org1' } }),
}));

const mockGetOrganization = vi.fn();
vi.mock('../../lib/firestore', () => ({
    getOrganization: (...args: unknown[]) => mockGetOrganization(...args),
}));

import { useAdminLogExport } from '../../hooks/useAdminLogExport';

describe('useAdminLogExport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mockGetOrganization.mockResolvedValue(null);
    });

    it('기관에 별도 설정이 없으면 결재란은 기본값(담당·팀장)이다', async () => {
        mockGetOrganization.mockResolvedValue({ name: '테스트기관' });
        const { result } = renderHook(() => useAdminLogExport());

        await waitFor(() => expect(result.current.orgName).toBe('테스트기관'));
        expect(result.current.approvalLine).toEqual([{ title: '담당' }, { title: '팀장' }]);
    });

    it('hideApprovalLine이면 결재란은 빈 배열이다', async () => {
        mockGetOrganization.mockResolvedValue({ name: 'A', hideApprovalLine: true });
        const { result } = renderHook(() => useAdminLogExport());

        await waitFor(() => expect(result.current.orgName).toBe('A'));
        expect(result.current.approvalLine).toEqual([]);
    });

    it('커스텀 결재란이 있으면 그 값을 사용한다', async () => {
        const custom = [{ title: '과장' }, { title: '센터장' }];
        mockGetOrganization.mockResolvedValue({ name: 'B', approvalLine: custom });
        const { result } = renderHook(() => useAdminLogExport());

        await waitFor(() => expect(result.current.orgName).toBe('B'));
        expect(result.current.approvalLine).toEqual(custom);
    });

    it('runExcel에서 예외가 나면 엑셀 error 토스트를 띄운다', async () => {
        const { result } = renderHook(() => useAdminLogExport());

        await act(async () => {
            await result.current.runExcel(async () => { throw new Error('boom'); });
        });

        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('엑셀'), 'error');
    });

    it('runPdf에서 예외가 나면 PDF error 토스트를 띄운다', async () => {
        const { result } = renderHook(() => useAdminLogExport());

        await act(async () => {
            await result.current.runPdf(async () => { throw new Error('boom'); });
        });

        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('PDF'), 'error');
    });
});
