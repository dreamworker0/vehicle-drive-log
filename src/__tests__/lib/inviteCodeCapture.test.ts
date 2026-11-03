import { describe, it, expect, beforeEach } from 'vitest';
import { captureInviteCodeFromUrl, withPendingInviteCode, PENDING_INVITE_CODE_KEY } from '@/lib/inviteCodeCapture';
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

describe('withPendingInviteCode', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('보관된 코드를 ?code=로 붙인다 (경로·다른 파라미터·해시는 유지)', () => {
        localStorage.setItem(PENDING_INVITE_CODE_KEY, 'ABC123');
        expect(withPendingInviteCode('https://drivelog.socialprism.co.kr/login?from=mail#top'))
            .toBe('https://drivelog.socialprism.co.kr/login?from=mail&code=ABC123#top');
    });

    it('보관된 코드가 없으면 주소를 그대로 돌려준다', () => {
        expect(withPendingInviteCode('https://drivelog.socialprism.co.kr/login'))
            .toBe('https://drivelog.socialprism.co.kr/login');
    });

    it('주소에 이미 코드가 있으면 덮어쓰지 않는다', () => {
        localStorage.setItem(PENDING_INVITE_CODE_KEY, 'ABC123');
        expect(withPendingInviteCode('https://drivelog.socialprism.co.kr/?code=ZZZ999'))
            .toBe('https://drivelog.socialprism.co.kr/?code=ZZZ999');
    });

    // 회귀 방지: 인앱에서 보관 → 주소에서 지움 → 외부 브라우저로 넘길 주소에 다시 실린다
    it('인앱에서 캡처한 코드가 외부 브라우저로 넘길 주소에 다시 실린다', () => {
        window.history.replaceState(null, '', '/?code=abc123');
        captureInviteCodeFromUrl();
        window.history.replaceState(null, '', '/login');

        const next = new URL(withPendingInviteCode(window.location.href));
        expect(next.pathname).toBe('/login');
        expect(next.searchParams.get('code')).toBe('ABC123');
    });
});
