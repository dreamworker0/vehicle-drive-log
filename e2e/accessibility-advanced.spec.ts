import { test, expect } from '@playwright/test';

test.describe('접근성 심화 검증', () => {
    // 참고: ConfirmModal 포커스 트랩은 컴포넌트 단위 테스트에서 실제 Tab/Shift+Tab 순환을
    // 검증한다(src/__tests__/components/ConfirmModal.test.tsx). E2E에서는 초기 화면에 모달이
    // 없어 의미 있는 단언이 어려우므로 여기서는 다루지 않는다.

    test('네비게이션에 aria-label이 있다', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(2000);

        const navs = page.locator('nav[aria-label]');
        const count = await navs.count();
        expect(count).toBeGreaterThanOrEqual(1);
    });

    test('aria-live 영역이 존재한다', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(2000);

        // 토스트 라이브 리전(role="status" aria-live="polite")은 ToastProviderWrapper가
        // 비인증 경량 엔트리에도 상시 렌더링하므로 랜딩에서 최소 1개 존재해야 한다.
        const liveRegions = page.locator('[aria-live]');
        await expect(liveRegions.first()).toBeAttached();
        expect(await liveRegions.count()).toBeGreaterThanOrEqual(1);
    });

    test('인터랙티브 요소에 키보드 접근이 가능하다', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(2000);

        // Tab 키로 첫 번째 인터랙티브 요소에 포커스 이동
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
            const el = document.activeElement;
            return el?.tagName?.toLowerCase();
        });
        // 포커스가 body가 아닌 인터랙티브 요소로 이동해야 함
        expect(['a', 'button', 'input', 'select', 'textarea']).toContain(focused);
    });

    test('html lang 속성이 설정되어 있다', async ({ page }) => {
        await page.goto('/');
        const lang = await page.locator('html').getAttribute('lang');
        expect(lang).toBe('ko');
    });

    test('DNS prefetch 링크가 존재한다', async ({ page }) => {
        await page.goto('/');
        const dnsPrefetch = page.locator('link[rel="dns-prefetch"]');
        const count = await dnsPrefetch.count();
        expect(count).toBeGreaterThanOrEqual(1);
    });
});
