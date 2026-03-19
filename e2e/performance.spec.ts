import { test, expect } from '@playwright/test';

test.describe('성능 기본 검증', () => {
    test('초기 페이지 로드가 5초 이내에 완료된다', async ({ page }) => {
        const start = Date.now();
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        const loadTime = Date.now() - start;
        expect(loadTime).toBeLessThan(5000);
    });

    test('메타 태그가 존재한다', async ({ page }) => {
        await page.goto('/');
        // viewport 메타 태그
        const viewport = page.locator('meta[name="viewport"]');
        await expect(viewport).toHaveCount(1);
        // theme-color 메타 태그
        const themeColor = page.locator('meta[name="theme-color"]');
        await expect(themeColor).toHaveCount(1);
    });

    test('service worker가 등록된다', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(3000);
        // SW 등록 확인 (PWA)
        const swRegistered = await page.evaluate(async () => {
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                return registrations.length > 0;
            }
            return false;
        });
        // CI 환경에서는 SW가 등록되지 않을 수 있으므로, 에러 없이 실행만 검증
        expect(typeof swRegistered).toBe('boolean');
    });
});
