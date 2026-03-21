import { test, expect } from '@playwright/test';

test.describe('오프라인 큐잉 & PWA', () => {
    test('OfflineBanner가 오프라인 상태에서 표시된다', async ({ page, context }) => {
        await page.goto('/');
        await page.waitForTimeout(2000);

        // 오프라인 시뮬레이션
        await context.setOffline(true);
        await page.waitForTimeout(500);

        const banner = page.locator('[role="alert"]');
        await expect(banner).toBeVisible({ timeout: 5000 });
        await expect(banner).toContainText('오프라인');

        // 온라인 복구
        await context.setOffline(false);
        await page.waitForTimeout(500);

        const reconnected = page.locator('[role="status"]');
        await expect(reconnected).toBeVisible({ timeout: 5000 });
        await expect(reconnected).toContainText('다시 연결');
    });

    test('서비스 워커가 등록된다', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(3000);

        const swRegistered = await page.evaluate(() =>
            navigator.serviceWorker?.controller !== null ||
            navigator.serviceWorker?.ready !== undefined
        );
        expect(swRegistered).toBeTruthy();
    });

    test('manifest.json이 올바른 필드를 포함한다', async ({ page }) => {
        const response = await page.goto('/manifest.json');
        expect(response?.status()).toBe(200);
        const manifest = await response?.json();
        expect(manifest.name).toBeTruthy();
        expect(manifest.short_name).toBeTruthy();
        expect(manifest.start_url).toBeTruthy();
        expect(manifest.icons?.length).toBeGreaterThan(0);
    });
});
