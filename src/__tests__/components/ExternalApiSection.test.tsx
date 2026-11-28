import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * ExternalApiSection — 설정의 외부 연동(API) 카드.
 * 고정하는 계약:
 *  - 요청 주소는 지금 접속한 도메인 + /api/v1/vehicles (호스팅 재작성 경로)
 *  - 키가 없으면 [API 키 발급], 있으면 끝 4자리와 [새 키로 교체]·[키 폐기]
 *  - 방금 발급한 원래 키는 경고와 함께 한 번만 보이고, [복사해 두었어요]로 지운다
 */
const hookState = {
    status: { hasKey: false } as { hasKey: boolean; hint?: string | null; createdAt?: string | null; lastUsedAt?: string | null } | null,
    loadFailed: false,
    issuedKey: null as string | null,
    busy: false,
    issue: vi.fn(),
    revoke: vi.fn(),
    dismissIssuedKey: vi.fn(),
    reload: vi.fn(),
};
vi.mock('@/hooks/useExternalApiKey', () => ({ useExternalApiKey: () => hookState }));

import ExternalApiSection from '@/components/admin/settings/ExternalApiSection';

describe('ExternalApiSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hookState.status = { hasKey: false };
        hookState.loadFailed = false;
        hookState.issuedKey = null;
    });

    it('요청 주소는 현재 도메인 + /api/v1/vehicles', () => {
        render(<ExternalApiSection />);
        expect(screen.getAllByText(`${window.location.origin}/api/v1/vehicles`).length).toBeGreaterThan(0);
    });

    it('키가 없으면 발급 버튼만', () => {
        render(<ExternalApiSection />);
        fireEvent.click(screen.getByRole('button', { name: /API 키 발급/ }));
        expect(hookState.issue).toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: '키 폐기' })).toBeNull();
    });

    it('키가 있으면 끝 4자리와 교체·폐기 버튼', () => {
        hookState.status = { hasKey: true, hint: 'AbCd', createdAt: '2026-11-28T00:00:00.000Z', lastUsedAt: null };
        render(<ExternalApiSection />);
        expect(screen.getByText('••••AbCd')).toBeInTheDocument();
        expect(screen.getByText(/아직 사용 기록 없음/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '키 폐기' }));
        expect(hookState.revoke).toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /새 키로 교체/ }));
        expect(hookState.issue).toHaveBeenCalled();
    });

    it('방금 발급한 키는 경고와 함께 보이고, 확인하면 지운다', () => {
        hookState.status = { hasKey: true, hint: 'WXYZ' };
        hookState.issuedKey = `dlk_${'a'.repeat(39)}WXYZ`;
        render(<ExternalApiSection />);
        expect(screen.getByText(/지금 한 번만 보입니다/)).toBeInTheDocument();
        expect(screen.getByText(hookState.issuedKey)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '복사해 두었어요' }));
        expect(hookState.dismissIssuedKey).toHaveBeenCalled();
    });

    it('상태를 못 불러오면 다시 시도 버튼', () => {
        hookState.loadFailed = true;
        render(<ExternalApiSection />);
        fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
        expect(hookState.reload).toHaveBeenCalled();
    });
});
