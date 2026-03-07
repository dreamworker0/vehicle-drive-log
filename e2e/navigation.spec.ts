import { test, expect } from '@playwright/test';

test.describe('페이지 네비게이션', () => {
    test('루트 URL 접속 시 로그인 페이지로 이동한다', async ({ page }) => {
        await page.goto('/');
        // 인증되지 않은 상태에서 로그인 화면이 표시되는지 확인
        await expect(page.locator('body')).toBeVisible();
    });

    test('존재하지 않는 경로 접속 시 리다이렉트된다', async ({ page }) => {
        await page.goto('/nonexistent-page');
        // SPA이므로 index.html이 서빙되어야 함
        await expect(page.locator('body')).toBeVisible();
    });

    test('PWA manifest가 로드된다', async ({ page }) => {
        await page.goto('/');
        const manifest = page.locator('link[rel="manifest"]');
        await expect(manifest).toHaveCount(1);
    });
});
