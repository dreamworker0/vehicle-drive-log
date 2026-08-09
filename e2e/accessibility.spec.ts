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
        const buttons = page.locator('button:visible');
        // 라벨을 **한 번의 평가로** 모아서 본다.
        //
        // 예전에는 버튼 개수를 센 뒤 인덱스로 하나씩 되물었는데, 그 사이에 페이지가 한 번
        // 다시 그려지면(첫 방문의 SW 설치 등) 방금 센 개수가 0이 되거나 요소가 떨어져 나가
        // mobile-safari에서 간헐적으로 깨졌다(2026-08-09 CI). 개수와 라벨을 같은 시점의
        // DOM에서 한꺼번에 읽으면 그 틈이 없어진다. 전체를 toPass로 감싸 일시적인 재렌더는
        // 다시 시도로 흡수하되, **검사 내용은 그대로다** — 보이는 버튼이 하나 이상 있고,
        // 그 전부가 텍스트·aria-label·title 중 하나를 가져야 한다.
        await expect(async () => {
            const labels = await buttons.evaluateAll((els) => els.map((el) => ({
                text: (el.textContent ?? '').trim(),
                ariaLabel: el.getAttribute('aria-label'),
                title: el.getAttribute('title'),
            })));

            expect(labels.length).toBeGreaterThan(0);
            for (const { text, ariaLabel, title } of labels) {
                expect(text.length > 0 || ariaLabel || title).toBeTruthy();
            }
        }).toPass({ timeout: 15000 });
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
