import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/tokenRefresh', () => ({
    refreshToken: vi.fn().mockResolvedValue(undefined),
    refreshTokenSilently: vi.fn(),
}));

import { syncClaimsWithUserDoc, isRecentlyCreated } from '../../../lib/authSession/claimsSync';
import { refreshToken, refreshTokenSilently } from '../../../lib/tokenRefresh';
import type { User as FirebaseUser } from 'firebase/auth';

const makeUser = (claims: Record<string, unknown>) =>
    ({ getIdTokenResult: vi.fn().mockResolvedValue({ claims }) }) as unknown as FirebaseUser;

describe('syncClaimsWithUserDoc', () => {
    beforeEach(() => vi.clearAllMocks());

    it('초기 로드에 캐시 토큰의 Claims가 문서와 다르면 백그라운드로 갱신한다', async () => {
        const user = makeUser({ role: 'employee', orgId: 'org-old' });

        const next = syncClaimsWithUserDoc(user, { role: 'employee', organizationId: 'org-1' }, {});

        expect(next).toEqual({ role: 'employee', orgId: 'org-1' });
        await vi.waitFor(() => expect(refreshToken).toHaveBeenCalledWith(user));
        expect(refreshTokenSilently).not.toHaveBeenCalled();
    });

    it('초기 로드에 Claims가 이미 맞으면 갱신하지 않는다', async () => {
        const user = makeUser({ role: 'admin', orgId: 'org-1' });

        syncClaimsWithUserDoc(user, { role: 'admin', organizationId: 'org-1' }, {});

        await vi.waitFor(() => expect(user.getIdTokenResult).toHaveBeenCalled());
        expect(refreshToken).not.toHaveBeenCalled();
    });

    it('이후 role이나 기관이 바뀌면 강제 갱신한다', () => {
        const user = makeUser({});

        syncClaimsWithUserDoc(user, { role: 'admin', organizationId: 'org-1' }, { role: 'employee', orgId: 'org-1' });
        syncClaimsWithUserDoc(user, { role: 'admin', organizationId: 'org-2' }, { role: 'admin', orgId: 'org-1' });

        expect(refreshTokenSilently).toHaveBeenCalledTimes(2);
        expect(user.getIdTokenResult).not.toHaveBeenCalled();
    });

    it('이후 스냅샷에 권한 변화가 없으면 아무것도 하지 않는다', () => {
        const user = makeUser({});

        const next = syncClaimsWithUserDoc(user, { role: 'admin', organizationId: 'org-1' }, { role: 'admin', orgId: 'org-1' });

        expect(next).toEqual({ role: 'admin', orgId: 'org-1' });
        expect(refreshTokenSilently).not.toHaveBeenCalled();
        expect(user.getIdTokenResult).not.toHaveBeenCalled();
    });
});

describe('isRecentlyCreated', () => {
    it('5초 안에 만든 문서만 참이다 (Timestamp·Date 모두)', () => {
        expect(isRecentlyCreated({ toMillis: () => Date.now() - 1000 })).toBe(true);
        expect(isRecentlyCreated(new Date(Date.now() - 1000))).toBe(true);
        expect(isRecentlyCreated({ toMillis: () => Date.now() - 10_000 })).toBe(false);
        expect(isRecentlyCreated(undefined)).toBe(false);
        expect(isRecentlyCreated('2026-01-01')).toBe(false);
    });
});
