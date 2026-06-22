/**
 * inAppBrowser.js 테스트
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isInAppBrowser, copyUrlToClipboard } from '../../lib/inAppBrowser';

describe('inAppBrowser', () => {
    const originalNavigator = { ...navigator };

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('isInAppBrowser', () => {
        const testCases = [
            { name: '카카오톡', ua: 'Mozilla/5.0 KAKAOTALK 10.0', expected: true },
            { name: '네이버', ua: 'Mozilla/5.0 NAVER(inapp;)', expected: true },
            { name: '페이스북', ua: 'Mozilla/5.0 [FBAN/FBIOS]', expected: true },
            { name: '인스타그램', ua: 'Mozilla/5.0 Instagram 200', expected: true },
            { name: '라인', ua: 'Mozilla/5.0 Line/13.0', expected: true },
            { name: '밴드', ua: 'Mozilla/5.0 (iPhone) BAND/14.0.0', expected: true },
            { name: '카카오스토리', ua: 'Mozilla/5.0 (iPhone) kakaostory/4.0', expected: true },
            { name: '다음', ua: 'Mozilla/5.0 (iPhone) DaumApps/4.5', expected: true },
            { name: 'Android 인앱(WebView)', ua: 'Mozilla/5.0 (Linux; Android 13; SM-G991N; wv) AppleWebKit/537.36', expected: true },
            { name: 'Chrome 일반', ua: 'Mozilla/5.0 Chrome/120.0', expected: false },
            { name: 'Safari 일반', ua: 'Mozilla/5.0 Safari/605.1.15', expected: false },
            // PWA 오탐 방지 회귀 케이스
            { name: 'iOS 설치형 PWA (Safari 없음)', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', expected: false },
            { name: 'Android Chrome 일반(비 WebView)', ua: 'Mozilla/5.0 (Linux; Android 13; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36', expected: false },
        ];

        testCases.forEach(({ name, ua, expected }) => {
            it(`${name} UA는 ${expected ? '인앱' : '일반'} 브라우저로 감지해야 한다`, () => {
                vi.stubGlobal('navigator', { userAgent: ua, vendor: '' });
                expect(isInAppBrowser()).toBe(expected);
            });
        });
    });

    describe('copyUrlToClipboard', () => {
        it('clipboard API 성공 시 true를 반환해야 한다', async () => {
            const writeTextMock = vi.fn().mockResolvedValue(undefined);
            vi.stubGlobal('navigator', {
                ...originalNavigator,
                clipboard: { writeText: writeTextMock },
            });

            const result = await copyUrlToClipboard('https://example.com');
            expect(result).toBe(true);
            expect(writeTextMock).toHaveBeenCalledWith('https://example.com');
        });

        it('clipboard API 미지원 시 fallback(execCommand)을 시도해야 한다', async () => {
            vi.stubGlobal('navigator', {
                ...originalNavigator,
                clipboard: { writeText: vi.fn().mockRejectedValue(new Error('not supported')) },
            });

            const execCommandMock = vi.fn().mockReturnValue(true);
            vi.stubGlobal('document', {
                ...document,
                createElement: vi.fn().mockReturnValue({
                    value: '',
                    style: {},
                    select: vi.fn(),
                }),
                body: {
                    appendChild: vi.fn(),
                    removeChild: vi.fn(),
                },
                execCommand: execCommandMock,
            });

            const result = await copyUrlToClipboard('https://example.com');
            expect(result).toBe(true);
        });
    });

    describe('openInExternalBrowser', () => {
        let locationSpy: ReturnType<typeof vi.fn> | undefined;

        afterEach(() => {
            if (locationSpy) locationSpy = undefined;
        });

        it('카카오톡 UA에서 kakaotalk:// 딥링크를 사용해야 한다', async () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 KAKAOTALK 26.1.6 iPhone', vendor: '' });
            // window.location.href 세터를 감시
            const hrefSetter = vi.fn();
            delete (window as unknown as Record<string, unknown>).location;
            (window as unknown as Record<string, unknown>).location = { href: 'https://vehicle-drive-log.web.app/login' };
            Object.defineProperty(window.location, 'href', { set: hrefSetter, get: () => 'https://vehicle-drive-log.web.app/login' });

            const { openInExternalBrowser } = await import('../../lib/inAppBrowser');
            openInExternalBrowser();

            expect(hrefSetter).toHaveBeenCalledWith(
                expect.stringContaining('kakaotalk://web/openExternal?url=')
            );
        });

        it('네이버 UA에서 naversearchapp:// 딥링크를 사용해야 한다', async () => {
            vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 NAVER(inapp;) iPhone', vendor: '' });
            const hrefSetter = vi.fn();
            delete (window as unknown as Record<string, unknown>).location;
            (window as unknown as Record<string, unknown>).location = { href: 'https://vehicle-drive-log.web.app/login' };
            Object.defineProperty(window.location, 'href', { set: hrefSetter, get: () => 'https://vehicle-drive-log.web.app/login' });

            const { openInExternalBrowser } = await import('../../lib/inAppBrowser');
            openInExternalBrowser();

            expect(hrefSetter).toHaveBeenCalledWith(
                expect.stringContaining('naversearchapp://inappbrowser?url=')
            );
        });
    });
});
