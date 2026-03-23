import { test, expect } from '@playwright/test';

test.describe('AuthGuard 작동 (인증 및 권한 라우터 가드)', () => {
    test('로그인하지 않은 상태에서 보호된 라우트(/admin) 접근 시 로그인 페이지로 리다이렉트된다', async ({ page }) => {
        await page.goto('/admin');

        // 비인증 시 "/" (랜딩 페이지)로 리다이렉트됨
        // URL이 /admin이 아닌 곳으로 변경될 때까지 대기
        await page.waitForURL((url) => !url.pathname.includes('/admin'), { timeout: 10000 });

        // 랜딩 페이지의 "차량 운행일지" 제목이 보이면 리다이렉트 성공
        await expect(page.getByRole('heading', { name: /차량 운행일지/ })).toBeVisible({ timeout: 10000 });
    });

    test('로그인하지 않은 상태에서 직원 라우트(/my-records) 접근 시 로그인 페이지로 리다이렉트된다', async ({ page }) => {
        await page.goto('/my-records');

        // URL이 /my-records가 아닌 곳으로 변경될 때까지 대기
        await page.waitForURL((url) => !url.pathname.includes('/my-records'), { timeout: 10000 });

        // 랜딩 페이지의 "차량 운행일지" 제목이 보이면 리다이렉트 성공
        await expect(page.getByRole('heading', { name: /차량 운행일지/ })).toBeVisible({ timeout: 10000 });
    });
});
