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

    // 위탁 조항(제9조)은 개인정보 보호법 제26조 제1항이 요구하는 문서 요건이다.
    // 조항이 사라지면 기관과의 위탁 계약 근거가 없어지므로 렌더를 고정한다.
    test('개인정보 처리의 위탁 조항(제9조)이 표시된다', async ({ page }) => {
        await page.goto('/terms');
        await expect(page.getByRole('heading', { name: /개인정보 처리의 위탁/ })).toBeVisible({ timeout: 10000 });
        await expect(page.getByText(/개인정보처리자는 기관입니다/)).toBeVisible();
        await expect(page.getByText(/재위탁 제한/)).toBeVisible();
        await expect(page.getByText(/손해배상 책임/)).toBeVisible();
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

    // 기관=개인정보처리자 / 서비스=수탁자 지위는 열람·삭제 요구와 유출 신고의 책임 소재를
    // 가르는 전제다. 전문이 사라지면 처리방침 전체의 해석이 뒤집힌다.
    test('개인정보처리자와 수탁자 지위가 명시된다', async ({ page }) => {
        await page.goto('/privacy');
        await expect(page.getByText(/개인정보처리자와 수탁자의 구분/)).toBeVisible({ timeout: 10000 });
        await expect(page.getByText(/각 기관이 소속 직원 개인정보의 개인정보처리자/)).toBeVisible();
    });
});

test.describe('랜딩 푸터에서 약관/개인정보로 이동', () => {
    test('이용약관 링크 클릭 시 약관 페이지로 이동한다', async ({ page }) => {
        await page.goto('/');
        const termsLink = page.getByRole('link', { name: '이용약관' }).first();
        await expect(termsLink).toBeVisible({ timeout: 10000 });
        // 하이드레이션 전 클릭이 no-op이 되는 레이스 방지: 이동 확정까지 재클릭(멱등)
        await expect(async () => {
            if (!/terms/.test(page.url())) await termsLink.click();
            await expect(page).toHaveURL(/terms/, { timeout: 1000 });
        }).toPass({ timeout: 10000 });
    });

    test('개인정보 처리방침 링크 클릭 시 개인정보 페이지로 이동한다', async ({ page }) => {
        await page.goto('/');
        const privacyLink = page.getByRole('link', { name: '개인정보 처리방침' }).first();
        await expect(privacyLink).toBeVisible({ timeout: 10000 });
        // 하이드레이션 전 클릭이 no-op이 되는 레이스 방지: 이동 확정까지 재클릭(멱등)
        await expect(async () => {
            if (!/privacy/.test(page.url())) await privacyLink.click();
            await expect(page).toHaveURL(/privacy/, { timeout: 1000 });
        }).toPass({ timeout: 10000 });
    });
});
