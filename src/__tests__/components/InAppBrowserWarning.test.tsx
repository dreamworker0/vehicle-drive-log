/**
 * InAppBrowserWarning — 외부 브라우저로 넘길 때 초대 코드를 함께 싣는다
 *
 * 카톡 인앱에서 초대 링크를 열면 코드는 인앱 저장소로 옮겨지고 주소에서 지워진다.
 * 외부 브라우저는 저장소가 따로라, 넘기는 주소에 코드가 없으면 초대 코드 화면이 빈 칸으로 뜬다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InAppBrowserWarning from '../../components/common/InAppBrowserWarning';
import { navigateTo } from '../../lib/browserNav';
import { captureInviteCodeFromUrl } from '../../lib/inviteCodeCapture';

// 딥링크 이동은 browserNav로 관찰한다(window.location 재정의는 vmThreads에서 불가)
vi.mock('../../lib/browserNav', () => ({
    navigateTo: vi.fn(),
    reloadPage: vi.fn(),
    currentHref: vi.fn(() => window.location.href),
}));

const KAKAOTALK_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.5.0';

/** 카톡 딥링크에서 외부 브라우저로 넘길 주소를 꺼낸다 */
function externalUrlFromKakaoDeepLink(deepLink: string): URL {
    const prefix = 'kakaotalk://web/openExternal?url=';
    expect(deepLink.startsWith(prefix)).toBe(true);
    return new URL(decodeURIComponent(deepLink.slice(prefix.length)));
}

describe('InAppBrowserWarning', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.stubGlobal('navigator', { ...navigator, userAgent: KAKAOTALK_UA, vendor: '' });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.mocked(navigateTo).mockClear();
        window.history.replaceState(null, '', '/');
    });

    it('초대 링크로 들어왔다면 외부 브라우저 주소에 코드를 다시 붙인다', () => {
        // 카톡에서 초대 링크를 열고(코드 보관·주소에서 제거) 로그인 화면으로 이동한 상태
        window.history.replaceState(null, '', '/?code=abc123');
        captureInviteCodeFromUrl();
        window.history.replaceState(null, '', '/login');

        render(<InAppBrowserWarning />);
        fireEvent.click(screen.getByRole('button', { name: '외부 브라우저에서 열기' }));

        const external = externalUrlFromKakaoDeepLink(vi.mocked(navigateTo).mock.calls[0][0]);
        expect(external.pathname).toBe('/login');
        expect(external.searchParams.get('code')).toBe('ABC123');
    });

    it('초대 코드가 없으면 현재 주소 그대로 넘긴다', () => {
        window.history.replaceState(null, '', '/login');

        render(<InAppBrowserWarning />);
        fireEvent.click(screen.getByRole('button', { name: '외부 브라우저에서 열기' }));

        const external = externalUrlFromKakaoDeepLink(vi.mocked(navigateTo).mock.calls[0][0]);
        expect(external.pathname).toBe('/login');
        expect(external.searchParams.has('code')).toBe(false);
    });

    it('주소 복사에도 코드를 붙인다', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { ...navigator, userAgent: KAKAOTALK_UA, vendor: '', clipboard: { writeText } });
        window.history.replaceState(null, '', '/?code=xyz789');
        captureInviteCodeFromUrl();
        window.history.replaceState(null, '', '/login');

        render(<InAppBrowserWarning />);
        fireEvent.click(screen.getByRole('button', { name: /주소\(URL\) 복사하기/ }));

        await waitFor(() => expect(writeText).toHaveBeenCalled());
        expect(new URL(writeText.mock.calls[0][0]).searchParams.get('code')).toBe('XYZ789');
    });
});
