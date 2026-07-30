import { test, expect } from '@playwright/test';

test.describe('접근성 심화 검증', () => {
    // 참고: ConfirmModal 포커스 트랩은 컴포넌트 단위 테스트에서 실제 Tab/Shift+Tab 순환을
    // 검증한다(src/__tests__/components/ConfirmModal.test.tsx). E2E에서는 초기 화면에 모달이
    // 없어 의미 있는 단언이 어려우므로 여기서는 다루지 않는다.

    test('네비게이션에 aria-label이 있다', async ({ page }) => {
        await page.goto('/');
        // 고정 대기(2s) 대신 렌더 완료를 폴링해 느린 CI에서의 레이스를 없앤다.
        const navs = page.locator('nav[aria-label]');
        await expect(navs.first()).toBeAttached({ timeout: 10000 });
        expect(await navs.count()).toBeGreaterThanOrEqual(1);
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

        // 하이드레이션 전에 Tab을 누르면 포커스가 body에 머문다. 고정 대기(2s)는 커버리지·
        // 에뮬레이터와 함께 도는 verify:full처럼 부하가 걸린 실행에서 부족해 실패했다.
        // 포커스 가능한 요소가 실제로 붙을 때까지 기다린 뒤, 이동이 확정될 때까지 재시도한다.
        // (같은 하이드레이션 레이스를 terms-privacy.spec.ts도 toPass로 처리한다.)
        const interactive = page.locator('a, button, input, select, textarea');
        await expect(interactive.first()).toBeVisible({ timeout: 10000 });

        await expect(async () => {
            // 재시도마다 포커스를 초기 상태로 되돌린다. 되돌리지 않으면 Tab이 누적되어
            // "첫 Tab이 인터랙티브 요소로 가는가"가 "N번 누르면 가는가"로 약해진다.
            await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
            await page.keyboard.press('Tab');
            const focused = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase());
            // 포커스가 body가 아닌 인터랙티브 요소로 이동해야 함
            expect(['a', 'button', 'input', 'select', 'textarea']).toContain(focused);
        }).toPass({ timeout: 10000 });
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
