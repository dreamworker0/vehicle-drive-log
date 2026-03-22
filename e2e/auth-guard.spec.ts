import { test, expect } from '@playwright/test';

test.describe('AuthGuard 작동 (인증 및 권한 라우터 가드)', () => {
    test('로그인하지 않은 상태에서 보호된 라우트(/admin) 접근 시 로그인 페이지로 리다이렉트된다', async ({ page }) => {
        // 비인증 상태로 /admin 접속 시도
        await page.goto('/admin');
        
        // 로그인 폼, 랜딩 페이지, 혹은 로그인 관련 UI가 보이는지 대기
        // (App.tsx나 AuthGuard에서 비인증자는 /login 또는 / 로 보냄)
        await page.waitForTimeout(1000); // 리다이렉션 대기

        // 로그인 버튼이 보이거나 URL이 리다이렉트 되었을 것
        const currentUrl = page.url();
        expect(currentUrl.includes('/login') || currentUrl === 'http://localhost:5173/').toBeTruthy();
        
        const loginBtn = page.getByText(/Google로 로그인/i);
        await expect(loginBtn).toBeVisible();
    });

    test('로그인하지 않은 상태에서 직원 라우트(/my-records) 접근 시 로그인 페이지로 리다이렉트된다', async ({ page }) => {
        // 비인증 상태로 /my-records 접속 시도
        await page.goto('/my-records');
        await page.waitForTimeout(1000); // 리다이렉션 대기

        const currentUrl = page.url();
        expect(currentUrl.includes('/login') || currentUrl === 'http://localhost:5173/').toBeTruthy();
    });
});
