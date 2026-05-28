import { test, expect } from '@playwright/test';

test.describe('접근성 기본 검증', () => {
    test.beforeEach(async ({ context, page }) => {
        await context.clearCookies();
        await context.clearPermissions();
        await page.goto('/');
        await page.evaluate(async () => {
            localStorage.clear();
            sessionStorage.clear();
            const dbs = await window.indexedDB.databases();
            for (const db of dbs) {
                if (db.name) {
                    window.indexedDB.deleteDatabase(db.name);
                }
            }
        });
    });

    test('랜딩 페이지에 h1 태그가 정확히 1개 존재한다', async ({ page }) => {
        await page.goto('/');
        const h1 = page.locator('h1');
        await expect(h1).toHaveCount(1);
    });

    test('모든 이미지에 alt 속성이 있다', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(2000);
        const images = page.locator('img');
        const count = await images.count();
        for (let i = 0; i < count; i++) {
            const alt = await images.nth(i).getAttribute('alt');
            // alt 속성이 존재해야 함 (빈 문자열은 데코레이션 이미지로 허용)
            expect(alt).not.toBeNull();
        }
    });

    test('버튼에 접근 가능한 텍스트가 있다', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(2000);
        const buttons = page.locator('button:visible');
        const count = await buttons.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
            const btn = buttons.nth(i);
            const text = await btn.textContent();
            const ariaLabel = await btn.getAttribute('aria-label');
            const title = await btn.getAttribute('title');
            // 텍스트, aria-label, title 중 최소 하나는 있어야 함
            const hasLabel = (text && text.trim().length > 0) || ariaLabel || title;
            expect(hasLabel).toBeTruthy();
        }
    });

    test('input 필드에 적절한 label이 있다', async ({ page }) => {
        await page.goto('/apply');
        // 폼이 렌더링될 때까지 대기
        await expect(page.getByPlaceholder('홍길동')).toBeVisible({ timeout: 10000 });
        const inputs = page.locator('input:visible');
        const count = await inputs.count();
        for (let i = 0; i < count; i++) {
            const input = inputs.nth(i);
            const type = await input.getAttribute('type');
            // checkbox는 label 검사에서 제외 (별도의 텍스트 레이블이 있음)
            if (type === 'checkbox') continue;
            const id = await input.getAttribute('id');
            const ariaLabel = await input.getAttribute('aria-label');
            const placeholder = await input.getAttribute('placeholder');
            const name = await input.getAttribute('name');
            // id, aria-label, placeholder, name 중 하나는 존재해야 함
            const hasAccessibleName = id || ariaLabel || placeholder || name;
            expect(hasAccessibleName).toBeTruthy();
        }
    });
});
