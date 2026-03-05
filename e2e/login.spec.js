import { test, expect } from '@playwright/test';

test.describe('로그인 페이지', () => {
    test('로그인 페이지가 렌더링된다', async ({ page }) => {
        await page.goto('/login');
        await expect(page.locator('body')).toBeVisible();
    });

    test('Google 로그인 버튼이 존재한다', async ({ page }) => {
        await page.goto('/login');
        const loginButton = page.getByText(/Google로 로그인/i);
        await expect(loginButton).toBeVisible({ timeout: 10000 });
    });

    test('앱 제목이 표시된다', async ({ page }) => {
        await page.goto('/login');
        const title = page.getByRole('heading', { name: /차량 운행일지/ });
        await expect(title).toBeVisible({ timeout: 10000 });
    });

    test('기관 신청 링크가 존재한다', async ({ page }) => {
        await page.goto('/');
        // 랜딩 페이지에서 기관 신청 버튼 확인
        const applyBtn = page.getByRole('button', { name: '기관 신청하기' });
        await expect(applyBtn).toBeVisible({ timeout: 10000 });
    });
});
