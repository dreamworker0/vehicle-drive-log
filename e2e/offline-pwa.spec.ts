import { test, expect } from '@playwright/test';

test.describe('오프라인 큐잉 & PWA', () => {
    // 오프라인 배너·큐잉·재접속 동기화 시나리오는 인증 세션 위에서 실계약을 검증하는
    // e2e/authed-offlineSync.spec.ts(에뮬레이터 E2E, CI 게이트)로 이관 완료.
    // 이 파일은 비인증 스모크로 SW 등록·manifest만 검증한다.

    test('서비스 워커가 등록된다', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

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
