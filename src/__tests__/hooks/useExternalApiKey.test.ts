import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

/**
 * useExternalApiKey — 설정 화면의 외부 연동(API) 키 상태·발급·폐기.
 * 고정하는 계약:
 *  - 모든 조회·조작은 manageExternalApiKey 콜러블 경유(키 컬렉션은 Rules로 막혀 있다)
 *  - 발급한 원래 키는 훅 상태에만 잠깐 있고, 확인하면 지운다
 *  - 키가 있는데 새로 발급하거나 폐기할 때는 확인을 받는다(취소하면 부르지 않는다)
 *  - 서버의 failed-precondition 안내(기능을 먼저 켜라 등)는 그대로 토스트로 보여 준다
 *  - 상태 조회 실패는 무한 로딩 대신 loadFailed로 접는다
 */
const mockShowToast = vi.fn();
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const mockConfirm = vi.fn<(...a: unknown[]) => Promise<boolean>>();
vi.mock('@/hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: mockConfirm }) }));

const mockManage = vi.fn<(...a: unknown[]) => Promise<unknown>>();
vi.mock('firebase/functions', () => ({
    httpsCallable: (_fns: unknown, name: string) => (...a: unknown[]) => {
        if (name !== 'manageExternalApiKey') throw new Error(`예상하지 못한 콜러블: ${name}`);
        return mockManage(...a);
    },
}));
vi.mock('@/lib/firebase', () => ({ firebaseFunctions: {} }));

import { useExternalApiKey } from '@/hooks/useExternalApiKey';

const NEW_KEY = `dlk_${'a'.repeat(39)}WXYZ`;

async function renderReady() {
    const hook = renderHook(() => useExternalApiKey());
    await waitFor(() => expect(hook.result.current.status).not.toBeNull());
    return hook;
}

describe('useExternalApiKey', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockConfirm.mockResolvedValue(true);
        mockManage.mockImplementation(async (payload) => {
            const { action } = payload as { action: string };
            if (action === 'status') return { data: { status: { hasKey: false } } };
            if (action === 'issue') return { data: { apiKey: NEW_KEY, status: { hasKey: true, hint: 'WXYZ', createdAt: '2026-11-28T00:00:00.000Z', lastUsedAt: null } } };
            return { data: { status: { hasKey: false } } };
        });
    });

    it('마운트하면 상태를 한 번 불러온다', async () => {
        const { result } = await renderReady();
        expect(mockManage).toHaveBeenCalledWith({ action: 'status' });
        expect(result.current.status).toEqual({ hasKey: false });
        expect(result.current.loadFailed).toBe(false);
    });

    it('상태 조회가 실패하면 loadFailed로 접는다', async () => {
        mockManage.mockRejectedValueOnce(new Error('network'));
        const { result } = await renderReady();
        expect(result.current.loadFailed).toBe(true);
    });

    it('키가 없을 때 발급은 확인 없이 바로 부르고, 원래 키를 한 번 보여 준다', async () => {
        const { result } = await renderReady();
        await act(async () => { await result.current.issue(); });
        expect(mockConfirm).not.toHaveBeenCalled();
        expect(mockManage).toHaveBeenCalledWith({ action: 'issue' });
        expect(result.current.issuedKey).toBe(NEW_KEY);
        expect(result.current.status).toMatchObject({ hasKey: true, hint: 'WXYZ' });

        act(() => result.current.dismissIssuedKey());
        expect(result.current.issuedKey).toBeNull();
    });

    it('키가 있을 때 교체는 확인을 받고, 취소하면 부르지 않는다', async () => {
        mockManage.mockResolvedValueOnce({ data: { status: { hasKey: true, hint: 'AbCd' } } });
        const { result } = await renderReady();
        mockConfirm.mockResolvedValueOnce(false);
        await act(async () => { await result.current.issue(); });
        expect(mockConfirm).toHaveBeenCalledTimes(1);
        expect(mockManage).not.toHaveBeenCalledWith({ action: 'issue' });
    });

    it('폐기는 확인 후 부르고, 보여 주던 키도 지운다', async () => {
        const { result } = await renderReady();
        await act(async () => { await result.current.issue(); });
        await act(async () => { await result.current.revoke(); });
        expect(mockConfirm).toHaveBeenCalled();
        expect(mockManage).toHaveBeenCalledWith({ action: 'revoke' });
        expect(result.current.issuedKey).toBeNull();
        expect(result.current.status).toEqual({ hasKey: false });
    });

    it('서버의 failed-precondition 안내는 그대로 보여 준다', async () => {
        const { result } = await renderReady();
        mockManage.mockRejectedValueOnce(Object.assign(new Error('설정 › 기능 사용에서 [외부 연동(API)]을 먼저 켜 주세요.'), { code: 'functions/failed-precondition' }));
        await act(async () => { await result.current.issue(); });
        expect(mockShowToast).toHaveBeenCalledWith('설정 › 기능 사용에서 [외부 연동(API)]을 먼저 켜 주세요.', 'error');
        expect(result.current.issuedKey).toBeNull();
    });

    it('그 밖의 실패는 일반 안내로', async () => {
        const { result } = await renderReady();
        mockManage.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'functions/internal' }));
        await act(async () => { await result.current.issue(); });
        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('발급하지 못했습니다'), 'error');
    });
});
