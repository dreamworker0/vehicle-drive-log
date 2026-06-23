import { test, expect } from '@playwright/test';

/**
 * 인앱 브라우저(카톡·네이버 등) 로그인 가드 회귀 테스트
 *
 * 배경: 인앱 감지 가드가 App.tsx(로그인 후 전체 앱)에만 있고, 비로그인 사용자가
 * 렌더되는 lightEntry에는 없어서, 카톡/네이버 인앱에서 로그인 버튼이 그대로
 * 노출되고 구글 로그인 시 403(disallowed_useragent)이 났던 회귀를 방지한다.
 *
 * 함수 단위 테스트(isInAppBrowser)와 달리, "사용자가 실제로 보는 화면"을
 * 검증하므로 엔트리 구조가 바뀌어도 가드 누락을 잡아낸다.
 *
 * 요구 동작:
 *  - `/`      : 인앱에서도 랜딩 페이지가 그대로 보여야 한다.
 *  - `/login` : 인앱에서는 외부 브라우저 안내 화면이 떠야 한다(구글 로그인 버튼 숨김).
 *  - 일반 브라우저: `/login`에서 구글 로그인 버튼이 정상 노출되어야 한다.
 */

// 실제 형태에 가까운 인앱 브라우저 User-Agent
const KAKAOTALK_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.5.0';
const NAVER_UA =
    'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 NAVER(inapp; search; 1234; 12.0.0)';

test.describe('인앱 브라우저 로그인 가드', () => {
    test.describe('카카오톡 인앱', () => {
        test.use({ userAgent: KAKAOTALK_UA });

        test('/login 에서 외부 브라우저 안내가 뜨고 구글 로그인 버튼은 숨겨진다', async ({ page }) => {
            await page.goto('/login');
            await expect(page.getByText('카카오톡 앱에서는 로그인이 안 돼요')).toBeVisible({ timeout: 10000 });
            await expect(page.getByRole('button', { name: '외부 브라우저에서 열기' })).toBeVisible();
            await expect(page.getByText(/Google로 로그인/i)).toHaveCount(0);
        });

        test('/ 랜딩은 인앱에서도 정상 노출된다', async ({ page }) => {
            await page.goto('/');
            await expect(page.getByRole('button', { name: '서비스 도입 신청' }).first()).toBeVisible({ timeout: 10000 });
            await expect(page.getByRole('button', { name: '외부 브라우저에서 열기' })).toHaveCount(0);
        });
    });

    test.describe('네이버 인앱', () => {
        test.use({ userAgent: NAVER_UA });

        test('/login 에서 외부 브라우저 안내가 뜬다', async ({ page }) => {
            await page.goto('/login');
            await expect(page.getByText('네이버 앱에서는 로그인이 안 돼요')).toBeVisible({ timeout: 10000 });
            await expect(page.getByRole('button', { name: '외부 브라우저에서 열기' })).toBeVisible();
        });
    });

    test.describe('일반 브라우저(가드가 일반 사용자를 막지 않아야 함)', () => {
        test('/login 에서 구글 로그인 버튼이 정상 노출된다', async ({ page }) => {
            await page.goto('/login');
            await expect(page.getByText(/Google로 로그인/i)).toBeVisible({ timeout: 10000 });
            await expect(page.getByRole('button', { name: '외부 브라우저에서 열기' })).toHaveCount(0);
        });
    });
});
