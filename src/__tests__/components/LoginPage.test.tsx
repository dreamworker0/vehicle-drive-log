/**
 * LoginPage — 리다이렉트 로그인 실패를 화면에 띄운다
 *
 * 프로덕션은 signInWithRedirect다. Google에서 돌아왔는데 로그인이 실패하면(user=null) 경량 앱의
 * 이 화면만 다시 그려지고, 전체 앱(useAuth)의 getRedirectResult는 로드되지 않는다. 그래서 비활성
 * 계정(auth/user-disabled)이 아무 안내 없이 로그인 화면으로 되돌아왔다(2026-11-18 기관 문의).
 * 이 화면이 결과를 직접 읽어 사유를 보여주는지 고정한다.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const { mockHandleRedirectResult, mockSignInWithGoogle } = vi.hoisted(() => ({
    mockHandleRedirectResult: vi.fn(),
    mockSignInWithGoogle: vi.fn(),
}));

vi.mock('../../lib/auth', () => ({
    handleRedirectResult: mockHandleRedirectResult,
    signInWithGoogle: mockSignInWithGoogle,
}));
vi.mock('../../components/common/SEOHead', () => ({ default: () => null }));
vi.mock('../../hooks/useForceLightMode', () => ({ default: () => undefined }));

import LoginPage from '../../components/auth/LoginPage';

function renderLogin() {
    return render(
        <MemoryRouter>
            <LoginPage />
        </MemoryRouter>,
    );
}

describe('LoginPage 리다이렉트 결과 처리', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('비활성 계정으로 돌아오면 관리자에게 다시 활성화를 요청하라고 안내한다', async () => {
        mockHandleRedirectResult.mockRejectedValue(Object.assign(new Error('disabled'), { code: 'auth/user-disabled' }));

        renderLogin();

        expect(await screen.findByRole('alert')).toHaveTextContent('계정이 비활성화되었습니다');
        expect(screen.getByRole('alert')).toHaveTextContent('다시 활성화를 요청');
    });

    it('그 밖의 리다이렉트 실패는 일반 실패 문구를 보여준다', async () => {
        mockHandleRedirectResult.mockRejectedValue(Object.assign(new Error('x'), { code: 'auth/network-request-failed' }));

        renderLogin();

        expect(await screen.findByRole('alert')).toHaveTextContent('로그인에 실패했습니다');
    });

    it('리다이렉트 결과가 없으면(처음 들어온 경우) 아무 안내도 띄우지 않는다', async () => {
        mockHandleRedirectResult.mockResolvedValue(null);

        renderLogin();

        await vi.waitFor(() => expect(mockHandleRedirectResult).toHaveBeenCalled());
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
