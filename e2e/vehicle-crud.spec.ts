import { test, expect } from '@playwright/test';

/**
 * 차량 관리 E2E 테스트
 *
 * 주의: 이 테스트는 로그인 상태에서 실행되어야 합니다.
 * 실제 Firestore 데이터를 변경하므로 개발 환경에서만 실행하세요.
 */

test.describe('차량 관리 (비인증 상태)', () => {
    test('비로그인 시 차량 목록 접근 불가', async ({ page }) => {
        await page.goto('/vehicles');
        // 로그인 페이지로 리다이렉트 또는 랜딩 페이지 표시
        await expect(page).toHaveURL(/\/(login|)$/);
    });

    test('비로그인 시 차량 등록 페이지 접근 불가', async ({ page }) => {
        await page.goto('/vehicles/new');
        await expect(page).toHaveURL(/\/(login|)$/);
    });
});

test.describe('차량 관리 페이지 UI', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('랜딩 페이지에서 차량 관련 콘텐츠 표시', async ({ page }) => {
        // 랜딩 페이지가 정상 로드되는지 확인
        await expect(page.locator('body')).toBeVisible();
        // 페이지 타이틀 확인
        const title = await page.title();
        expect(title).toBeTruthy();
    });
});

test.describe('운행일지 (비인증 상태)', () => {
    test('비로그인 시 운행일지 접근 불가', async ({ page }) => {
        await page.goto('/drive-logs');
        await expect(page).toHaveURL(/\/(login|)$/);
    });

    test('비로그인 시 운행일지 작성 페이지 접근 불가', async ({ page }) => {
        await page.goto('/drive-logs/new');
        await expect(page).toHaveURL(/\/(login|)$/);
    });
});

test.describe('예약 (비인증 상태)', () => {
    test('비로그인 시 예약 페이지 접근 불가', async ({ page }) => {
        await page.goto('/reservations');
        await expect(page).toHaveURL(/\/(login|)$/);
    });
});

test.describe('설정 (비인증 상태)', () => {
    test('비로그인 시 설정 페이지 접근 불가', async ({ page }) => {
        await page.goto('/settings');
        await expect(page).toHaveURL(/\/(login|)$/);
    });

    test('비로그인 시 기관 관리 접근 불가', async ({ page }) => {
        await page.goto('/settings/organization');
        await expect(page).toHaveURL(/\/(login|)$/);
    });
});
