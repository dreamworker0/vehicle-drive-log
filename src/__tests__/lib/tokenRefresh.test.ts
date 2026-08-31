/**
 * tokenRefresh — 리트라이/디바운스 유틸리티 테스트
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('tokenRefresh', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('refreshToken 성공 시 에러 없이 완료', async () => {
        const { refreshToken } = await import('../../lib/tokenRefresh');
        const mockUser = { getIdToken: vi.fn().mockResolvedValue('token') } as unknown as Parameters<typeof refreshToken>[0];

        await expect(refreshToken(mockUser)).resolves.toBeUndefined();
        expect(mockUser.getIdToken).toHaveBeenCalledWith(true);
    });

    it('refreshTokenSilently는 에러 삼킴', async () => {
        const { refreshTokenSilently } = await import('../../lib/tokenRefresh');
        const mockUser = {
            getIdToken: vi.fn().mockRejectedValue(new Error('auth/user-disabled')),
        } as unknown as Parameters<typeof refreshTokenSilently>[0];

        // 에러가 발생해도 throw 하지 않음
        await expect(refreshTokenSilently(mockUser)).resolves.toBeUndefined();
    });

    /**
     * 세션을 끊는 실패(SDK가 스스로 signOut 한다)와 네트워크 실패는 처방이 정반대다.
     * "갑자기 로그아웃됐다"의 원인을 지목하려면 이 구분이 기록에 남아 있어야 한다.
     */
    it('세션이 무효화되는 코드는 fatal로 기록한다', async () => {
        const { refreshToken, getLastTokenRefreshFailure } = await import('../../lib/tokenRefresh');
        const mockUser = {
            getIdToken: vi.fn().mockRejectedValue({ code: 'auth/user-token-expired' }),
        } as unknown as Parameters<typeof refreshToken>[0];

        await expect(refreshToken(mockUser)).rejects.toBeTruthy();

        expect(getLastTokenRefreshFailure()).toMatchObject({
            code: 'auth/user-token-expired',
            fatal: true,
        });
    });

    it('네트워크 실패는 기록하되 fatal이 아니다 (재시도가 처방이라 로그아웃 원인이 아니다)', async () => {
        vi.useFakeTimers();
        const { refreshToken, getLastTokenRefreshFailure } = await import('../../lib/tokenRefresh');
        const mockUser = {
            getIdToken: vi.fn().mockRejectedValue({ code: 'auth/network-request-failed' }),
        } as unknown as Parameters<typeof refreshToken>[0];

        const pending = refreshToken(mockUser, 2);
        const assertion = expect(pending).rejects.toBeTruthy();
        await vi.advanceTimersByTimeAsync(2000); // 백오프 소진
        await assertion;
        vi.useRealTimers();

        expect(getLastTokenRefreshFailure()).toMatchObject({
            code: 'auth/network-request-failed',
            fatal: false,
        });
    });

    it('갱신에 성공하면 이전 실패 기록을 지운다 (낡은 실패가 원인으로 지목되지 않게)', async () => {
        const { refreshToken, getLastTokenRefreshFailure } = await import('../../lib/tokenRefresh');
        const failing = {
            getIdToken: vi.fn().mockRejectedValue({ code: 'auth/user-disabled' }),
        } as unknown as Parameters<typeof refreshToken>[0];
        await expect(refreshToken(failing)).rejects.toBeTruthy();
        expect(getLastTokenRefreshFailure()).not.toBeNull();

        const recovered = {
            getIdToken: vi.fn().mockResolvedValue('token'),
        } as unknown as Parameters<typeof refreshToken>[0];
        await refreshToken(recovered);

        expect(getLastTokenRefreshFailure()).toBeNull();
    });

    it('네트워크 에러가 아닌 경우 즉시 에러 전파', async () => {
        const { refreshToken } = await import('../../lib/tokenRefresh');
        const mockUser = {
            getIdToken: vi.fn().mockRejectedValue({ code: 'auth/user-disabled', message: 'disabled' }),
        } as unknown as Parameters<typeof refreshToken>[0];

        await expect(refreshToken(mockUser)).rejects.toEqual(
            expect.objectContaining({ code: 'auth/user-disabled' })
        );
        // 재시도 없이 1회만 호출
        expect(mockUser.getIdToken).toHaveBeenCalledTimes(1);
    });
});
