import { describe, it, expect, beforeEach } from 'vitest';
import { captureInviteCodeFromUrl, PENDING_INVITE_CODE_KEY } from '@/lib/inviteCodeCapture';
import MAIN_SOURCE from '../../main.tsx?raw';

describe('captureInviteCodeFromUrl', () => {
    beforeEach(() => {
        localStorage.clear();
        window.history.replaceState(null, '', '/');
    });

    it('?code=를 대문자로 보관하고 주소창에서 지운다 (다른 파라미터·경로는 남긴다)', () => {
        window.history.replaceState(null, '', '/login?code=abc123&from=mail#top');

        captureInviteCodeFromUrl();

        expect(localStorage.getItem(PENDING_INVITE_CODE_KEY)).toBe('ABC123');
        expect(window.location.pathname).toBe('/login');
        expect(window.location.search).toBe('?from=mail');
        expect(window.location.hash).toBe('#top');
    });

    it('코드가 없으면 아무것도 하지 않는다 — 보관된 코드를 지우지 않는다', () => {
        localStorage.setItem(PENDING_INVITE_CODE_KEY, 'KEEP01');
        window.history.replaceState(null, '', '/login');

        captureInviteCodeFromUrl();

        expect(localStorage.getItem(PENDING_INVITE_CODE_KEY)).toBe('KEEP01');
    });

    it('두 번 불려도 안전하다 (main.tsx와 App.tsx가 모두 부른다)', () => {
        window.history.replaceState(null, '', '/?code=xyz789');
        captureInviteCodeFromUrl();
        captureInviteCodeFromUrl();
        expect(localStorage.getItem(PENDING_INVITE_CODE_KEY)).toBe('XYZ789');
    });

    // 회귀 방지: 경량 화면(비로그인)으로 시작해도 코드를 놓치지 않으려면 부팅 첫 지점에서 불러야 한다
    it('main.tsx가 엔트리 분기 전에 부른다', () => {
        const call = MAIN_SOURCE.indexOf('captureInviteCodeFromUrl();');
        const branch = MAIN_SOURCE.indexOf("import('./lightEntry')");
        expect(call).toBeGreaterThan(-1);
        expect(branch).toBeGreaterThan(-1);
        expect(call).toBeLessThan(branch);
    });
});
