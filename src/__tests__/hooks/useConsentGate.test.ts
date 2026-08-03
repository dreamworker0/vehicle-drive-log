/**
 * useConsentGate — 재동의 필요 여부 판정
 *
 * 관리자는 차단 모달, 직원은 비차단 배너로 갈리므로 판정이 틀리면
 * 직원을 차단하거나 관리자의 위탁 동의를 놓친다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import useConsentGate from '../../hooks/useConsentGate';
import { TERMS_VERSION, PRIVACY_VERSION } from '../../lib/constants';

const mockAcceptFn = vi.fn();
vi.mock('firebase/functions', () => ({
    httpsCallable: vi.fn(() => mockAcceptFn),
}));
vi.mock('../../lib/firebase', () => ({ firebaseFunctions: {} }));
vi.mock('../../lib/sentry', () => ({ captureError: vi.fn() }));

const mockGetOrganization = vi.fn();
vi.mock('../../lib/firestore', () => ({
    getOrganization: (...args: unknown[]) => mockGetOrganization(...args),
}));

type MockAuth = {
    user: { uid: string } | null;
    userData: Record<string, unknown> | null;
    userDocState: 'pending' | 'present' | 'absent';
};
let mockAuth: MockAuth;
vi.mock('../../hooks/useAuth', () => ({
    useAuth: () => mockAuth,
}));

/** 현행 버전에 동의한 상태 */
const CURRENT_USER_CONSENT = { terms: true, termsVersion: TERMS_VERSION };
const CURRENT_ORG_CONSENT = {
    terms: true,
    privacy: true,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
};

describe('useConsentGate — 판정', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAcceptFn.mockResolvedValue({ data: { success: true } });
        mockGetOrganization.mockResolvedValue({ consent: CURRENT_ORG_CONSENT });
        mockAuth = {
            user: { uid: 'u1' },
            userData: { role: 'employee', organizationId: 'org-1', consent: CURRENT_USER_CONSENT },
            userDocState: 'present',
        };
    });

    it('사용자 문서 로딩 확정 전에는 게이트를 띄우지 않는다', async () => {
        mockAuth = { ...mockAuth, userDocState: 'pending', userData: null };
        const { result } = renderHook(() => useConsentGate());
        await waitFor(() => expect(result.current.requirement).toBe('none'));
    });

    it('기관이 없는 상태(초대 코드 입력·승인 대기)는 제외한다', async () => {
        // 가입 플로우가 동의를 받으므로 여기서 또 요구하면 중복이다
        mockAuth = {
            ...mockAuth,
            userData: { role: 'employee', organizationId: null, consent: undefined },
        };
        const { result } = renderHook(() => useConsentGate());
        await waitFor(() => expect(result.current.requirement).toBe('none'));
        expect(mockGetOrganization).not.toHaveBeenCalled();
    });

    it('현행 버전에 동의한 직원은 게이트가 없다', async () => {
        const { result } = renderHook(() => useConsentGate());
        await waitFor(() => expect(result.current.requirement).toBe('none'));
    });

    it('동의 기록이 없는 직원 → 비차단 배너', async () => {
        mockAuth = {
            ...mockAuth,
            userData: { role: 'employee', organizationId: 'org-1', consent: undefined },
        };
        const { result } = renderHook(() => useConsentGate());
        await waitFor(() => expect(result.current.requirement).toBe('employee'));
        // 직원 판정에는 기관 문서를 읽지 않는다(불필요한 읽기 방지)
        expect(mockGetOrganization).not.toHaveBeenCalled();
    });

    it('이전 버전에 동의한 직원 → 비차단 배너', async () => {
        mockAuth = {
            ...mockAuth,
            userData: {
                role: 'employee',
                organizationId: 'org-1',
                consent: { terms: true, termsVersion: '2026-02-01' },
            },
        };
        const { result } = renderHook(() => useConsentGate());
        await waitFor(() => expect(result.current.requirement).toBe('employee'));
    });

    it('기관 동의가 없는 관리자 → 차단 모달', async () => {
        mockAuth = {
            ...mockAuth,
            userData: { role: 'admin', organizationId: 'org-1', consent: CURRENT_USER_CONSENT },
        };
        mockGetOrganization.mockResolvedValue({ consent: undefined });
        const { result } = renderHook(() => useConsentGate());
        await waitFor(() => expect(result.current.requirement).toBe('admin'));
    });

    it('기관 동의는 있으나 본인 약관 동의가 없는 관리자 → 차단 모달', async () => {
        mockAuth = {
            ...mockAuth,
            userData: { role: 'admin', organizationId: 'org-1', consent: undefined },
        };
        const { result } = renderHook(() => useConsentGate());
        await waitFor(() => expect(result.current.requirement).toBe('admin'));
    });

    it('기관·본인 모두 현행 버전에 동의한 관리자는 게이트가 없다', async () => {
        mockAuth = {
            ...mockAuth,
            userData: { role: 'admin', organizationId: 'org-1', consent: CURRENT_USER_CONSENT },
        };
        const { result } = renderHook(() => useConsentGate());
        await waitFor(() => expect(result.current.requirement).toBe('none'));
    });

    it('기관 문서 읽기 실패 시 관리자를 차단하지 않는다', async () => {
        // 읽기 실패로 차단하면 복구 수단 없이 앱을 못 쓰게 된다
        mockAuth = {
            ...mockAuth,
            userData: { role: 'admin', organizationId: 'org-1', consent: CURRENT_USER_CONSENT },
        };
        mockGetOrganization.mockRejectedValue(new Error('permission-denied'));
        const { result } = renderHook(() => useConsentGate());
        await waitFor(() => expect(result.current.requirement).toBe('none'));
    });
});

describe('useConsentGate — 동의 기록', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAcceptFn.mockResolvedValue({ data: { success: true } });
        mockGetOrganization.mockResolvedValue({ consent: undefined });
        mockAuth = {
            user: { uid: 'u1' },
            userData: { role: 'employee', organizationId: 'org-1', consent: undefined },
            userDocState: 'present',
        };
    });

    it('직원 동의는 약관만 전송한다', async () => {
        const { result } = renderHook(() => useConsentGate());
        await waitFor(() => expect(result.current.requirement).toBe('employee'));

        await act(async () => { await result.current.accept(); });

        expect(mockAcceptFn).toHaveBeenCalledWith({
            agreedTerms: true,
            termsVersion: TERMS_VERSION,
        });
        expect(result.current.requirement).toBe('none');
    });

    it('관리자 동의는 처리방침까지 함께 전송한다', async () => {
        mockAuth = {
            ...mockAuth,
            userData: { role: 'admin', organizationId: 'org-1', consent: undefined },
        };
        const { result } = renderHook(() => useConsentGate());
        await waitFor(() => expect(result.current.requirement).toBe('admin'));

        await act(async () => { await result.current.accept(); });

        expect(mockAcceptFn).toHaveBeenCalledWith({
            agreedTerms: true,
            termsVersion: TERMS_VERSION,
            agreedPrivacy: true,
            privacyVersion: PRIVACY_VERSION,
        });
    });

    it('응답이 늦으면 한 번 더 부른다 — 관리자는 차단 모달에 갇히면 앱을 못 쓴다', async () => {
        mockAcceptFn
            // SDK가 시간 초과 시 던지는 것과 같은 모양
            .mockRejectedValueOnce(Object.assign(new Error('deadline-exceeded'), { code: 'functions/deadline-exceeded' }))
            .mockResolvedValueOnce({ data: { success: true } });
        const { result } = renderHook(() => useConsentGate());
        await waitFor(() => expect(result.current.requirement).toBe('employee'));

        await act(async () => { await result.current.accept(); });

        expect(mockAcceptFn).toHaveBeenCalledTimes(2);
        expect(result.current.requirement).toBe('none');
        expect(result.current.error).toBe('');
    });

    it('기록 실패 시 게이트를 닫지 않고 오류를 표시한다', async () => {
        mockAcceptFn.mockRejectedValue(new Error('internal'));
        const { result } = renderHook(() => useConsentGate());
        await waitFor(() => expect(result.current.requirement).toBe('employee'));

        await act(async () => { await result.current.accept(); });

        expect(result.current.requirement).toBe('employee');
        expect(result.current.error).toContain('오류');
    });
});
