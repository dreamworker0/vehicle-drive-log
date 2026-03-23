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
