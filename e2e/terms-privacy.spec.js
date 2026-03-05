import { test, expect } from '@playwright/test';

test.describe('이용약관 페이지', () => {
    test('이용약관 페이지가 렌더링된다', async ({ page }) => {
        await page.goto('/terms');
        await expect(page.getByRole('heading', { name: /이용약관/ })).toBeVisible({ timeout: 10000 });
    });

    test('주요 약관 섹션이 표시된다', async ({ page }) => {
        await page.goto('/terms');
        // 제1조 (목적) 섹션이 표시되어야 함
        await expect(page.getByRole('heading', { name: /목적/ })).toBeVisible({ timeout: 10000 });
        await expect(page.getByText(/이용 조건/)).toBeVisible();
    });

    test('돌아가기 네비게이션이 동작한다', async ({ page }) => {
        await page.goto('/terms');
        const backBtn = page.getByText('돌아가기');
        await expect(backBtn).toBeVisible({ timeout: 10000 });
    });
});

test.describe('개인정보 처리방침 페이지', () => {
    test('개인정보 처리방침 페이지가 렌더링된다', async ({ page }) => {
        await page.goto('/privacy');
        await expect(page.getByRole('heading', { name: /개인정보 처리방침/ })).toBeVisible({ timeout: 10000 });
    });

    test('주요 처리방침 내용이 표시된다', async ({ page }) => {
        await page.goto('/privacy');
        // 제1조 (수집하는 개인정보 항목) 섹션 확인
        await expect(page.getByRole('heading', { name: /수집하는 개인정보/ })).toBeVisible({ timeout: 10000 });
    });
});

test.describe('랜딩 푸터에서 약관/개인정보로 이동', () => {
    test('이용약관 링크 클릭 시 약관 페이지로 이동한다', async ({ page }) => {
        await page.goto('/');
        const termsLink = page.getByRole('link', { name: '이용약관' }).first();
        await expect(termsLink).toBeVisible({ timeout: 10000 });
        await termsLink.click();
        await expect(page).toHaveURL(/terms/);
    });

    test('개인정보 처리방침 링크 클릭 시 개인정보 페이지로 이동한다', async ({ page }) => {
        await page.goto('/');
        const privacyLink = page.getByRole('link', { name: '개인정보 처리방침' }).first();
        await expect(privacyLink).toBeVisible({ timeout: 10000 });
        await privacyLink.click();
        await expect(page).toHaveURL(/privacy/);
    });
});
