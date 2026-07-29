/**
 * InviteCodePage — 직원 가입 시 이용약관 동의 게이트
 *
 * 종전에는 초대 링크에 코드가 있으면 화면 없이 자동 가입했다. 약관 동의를 기록하려면
 * 명시적 동의가 필요하므로 확인 단계를 거치도록 바꿨고, 그 회귀를 여기서 고정한다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InviteCodePage from '../../components/auth/InviteCodePage';
import { TERMS_VERSION } from '../../lib/constants';

const mockJoinOrg = vi.fn();
vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn(() => mockJoinOrg),
}));

vi.mock('../../lib/firebase', () => ({
    auth: { currentUser: null },
    firebaseFunctions: {},
}));
vi.mock('../../lib/auth', () => ({ logout: vi.fn() }));
vi.mock('../../lib/tokenRefresh', () => ({ refreshTokenSilently: vi.fn() }));

let mockAuth: { user: Record<string, unknown> | null; userData: Record<string, unknown> | null };
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => mockAuth,
}));

const renderPage = () =>
    render(
        <MemoryRouter>
            <InviteCodePage />
        </MemoryRouter>
    );

describe('InviteCodePage — 이용약관 동의 게이트', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockJoinOrg.mockResolvedValue({ data: { success: true } });
        mockAuth = {
            user: { uid: 'u1', email: 'employee@example.com', displayName: '홍길동', isAnonymous: false },
            userData: null,
        };
        window.localStorage.clear();
        window.history.replaceState({}, '', '/invite');
    });

    it('약관 동의 체크박스가 노출된다', () => {
        renderPage();
        expect(screen.getByRole('checkbox')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: '이용약관' })).toHaveAttribute('href', '/terms');
    });

    it('개인정보 처리방침 동의는 요구하지 않는다 (기관이 개인정보처리자)', () => {
        renderPage();
        // 체크박스는 약관 1개만 — 개인정보 동의를 받으면 처리자처럼 행동한 것이 된다
        expect(screen.getAllByRole('checkbox')).toHaveLength(1);
        expect(screen.getByText(/소속 기관이 개인정보처리자/)).toBeInTheDocument();
    });

    it('미동의 상태에서는 참여 버튼이 비활성화된다', () => {
        renderPage();

        fireEvent.change(screen.getByPlaceholderText('______'), { target: { value: 'ABC123' } });
        const submit = screen.getByRole('button', { name: '기관 참여하기' });
        expect(submit).toBeDisabled();

        fireEvent.click(screen.getByRole('checkbox'));
        expect(submit).toBeEnabled();
    });

    it('동의 후 제출하면 동의 사실과 약관 버전이 함께 전달된다', async () => {
        renderPage();

        fireEvent.change(screen.getByPlaceholderText('______'), { target: { value: 'ABC123' } });
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: '기관 참여하기' }));

        await waitFor(() => expect(mockJoinOrg).toHaveBeenCalledWith({
            code: 'ABC123',
            agreedTerms: true,
            termsVersion: TERMS_VERSION,
        }));
    });

    it('초대 링크로 코드가 들어와도 자동 가입하지 않고 동의를 먼저 받는다', async () => {
        window.history.replaceState({}, '', '/invite?code=ABC123');
        renderPage();

        // 코드는 채워지지만 동의 없이는 호출되지 않는다
        expect(screen.getByPlaceholderText('______')).toHaveValue('ABC123');
        expect(screen.getByRole('heading', { name: '기관 참여 확인' })).toBeInTheDocument();
        await waitFor(() => expect(mockJoinOrg).not.toHaveBeenCalled());
        expect(screen.getByRole('button', { name: '기관 참여하기' })).toBeDisabled();
    });
});
