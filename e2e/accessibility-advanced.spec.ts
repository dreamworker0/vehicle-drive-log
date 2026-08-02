import { test, expect } from '@playwright/test';

test.describe('접근성 심화 검증', () => {
    // 참고: ConfirmModal 포커스 트랩은 컴포넌트 단위 테스트에서 실제 Tab/Shift+Tab 순환을
    // 검증한다(src/__tests__/components/ConfirmModal.test.tsx). E2E에서는 초기 화면에 모달이
    // 없어 의미 있는 단언이 어려우므로 여기서는 다루지 않는다.

    /*
     * `count()`는 **재시도하지 않는 일회성 읽기**다. `toBeAttached()`로 요소가 붙는 것까지
     * 기다려도, 그 다음 줄의 `count()`가 실행되는 순간 진입 직후 트리 교체(라우팅 판정)와
     * 겹치면 0을 읽고 그대로 실패로 굳는다 — master CI에서 초기 시도와 재시도 2회가 모두
     * 같은 지점에서 깨졌고(2026-08-03), 로컬 동일 조건에서는 재현되지 않았다.
     * 웹 우선 단언(`toHaveCount`)은 같은 의도를 **재시도로** 검증하므로 이 창을 통과한다.
     * 같은 계열을 `5cfc051`(키보드 포커스)·terms-privacy(toPass)에서 이미 한 번 걷어냈다.
     */
    test('네비게이션에 aria-label이 있다', async ({ page }) => {
        await page.goto('/');
        const navs = page.locator('nav[aria-label]');
        await expect(navs).not.toHaveCount(0, { timeout: 10000 });
    });

    test('aria-live 영역이 존재한다', async ({ page }) => {
        await page.goto('/');

        // 토스트 라이브 리전(role="status" aria-live="polite")은 ToastProviderWrapper가
        // 비인증 경량 엔트리에도 상시 렌더링하므로 랜딩에서 최소 1개 존재해야 한다.
        // 고정 대기(2s)는 부하가 걸린 CI에서 부족할 수 있어 재시도 단언으로 대체한다.
        const liveRegions = page.locator('[aria-live]');
        await expect(liveRegions).not.toHaveCount(0, { timeout: 10000 });
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
