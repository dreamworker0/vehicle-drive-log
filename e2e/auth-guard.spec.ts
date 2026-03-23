import { test, expect } from '@playwright/test';

test.describe('AuthGuard 작동 (인증 및 권한 라우터 가드)', () => {
    test('로그인하지 않은 상태에서 보호된 라우트(/admin) 접근 시 로그인 페이지로 리다이렉트된다', async ({ page }) => {
        // 비인증 상태로 /admin 접속 시도
        await page.goto('/admin');

        // 리다이렉트 또는 로그인 UI가 나타날 때까지 대기
        // (App.tsx에서 비인증자는 "/" 로 리다이렉트 → LoginPage 렌더)
        await page.waitForTimeout(2000);

        // URL이 /admin이 아닌 곳으로 리다이렉트 되었는지 확인
        const currentUrl = page.url();
        expect(currentUrl).not.toContain('/admin');

        // 로그인 버튼이 보이는지 확인 (로딩 상태 포함)
        const loginBtn = page.getByText(/Google로 로그인|로그인 중/i);
        await expect(loginBtn).toBeVisible({ timeout: 10000 });
    });

    test('로그인하지 않은 상태에서 직원 라우트(/my-records) 접근 시 로그인 페이지로 리다이렉트된다', async ({ page }) => {
        // 비인증 상태로 /my-records 접속 시도
        await page.goto('/my-records');
        await page.waitForTimeout(2000);

        // URL이 /my-records가 아닌 곳으로 리다이렉트 되었는지 확인
        const currentUrl = page.url();
        expect(currentUrl).not.toContain('/my-records');

        // 로그인 버튼이 보이는지 확인
        const loginBtn = page.getByText(/Google로 로그인|로그인 중/i);
        await expect(loginBtn).toBeVisible({ timeout: 10000 });
    });
});
