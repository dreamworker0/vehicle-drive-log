import { test, expect } from '@playwright/test';

test.describe('반응형 레이아웃', () => {
    test('모바일 뷰포트에서 랜딩 페이지가 정상 렌더링된다', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 }); // iPhone 크기
        await page.goto('/');
        await expect(page.getByRole('heading', { name: /차량 운행일지/ })).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole('button', { name: '기관 신청하기' })).toBeVisible();
    });

    test('태블릿 뷰포트에서 랜딩 페이지가 정상 렌더링된다', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 }); // iPad 크기
        await page.goto('/');
        await expect(page.getByRole('heading', { name: /차량 운행일지/ })).toBeVisible({ timeout: 10000 });
    });

    test('모바일에서 로그인 페이지가 정상 렌더링된다', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto('/login');
        const loginButton = page.getByText(/Google로 로그인/i);
        await expect(loginButton).toBeVisible({ timeout: 10000 });
    });
});
