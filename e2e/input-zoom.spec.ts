import { test, expect, type Page } from '@playwright/test';

/**
 * iOS 사파리 입력칸 포커스 확대 방지 (src/index.css)
 *
 * iOS 사파리는 글자가 16px보다 작은 input·select·textarea에 포커스가 가면 화면을 확대한다.
 * 모바일 폭·터치 기기에서는 공용 규칙이 입력칸 글자를 16px 이상으로 올리고,
 * 데스크톱에서는 원래 밀도(text-sm 15px)를 그대로 둔다.
 */

// 화면에 실제로 쓰이는 조합을 본뜬 견본 — 부모가 text-sm인 상태에서 type 없는 input·date·search가
// 상속으로 작아지는 경우와, 입력칸에 직접 붙은 text-xs·text-sm 유틸리티를 함께 본다.
const PROBE_HTML = `
<div id="zoom-probe" class="text-sm">
  <input class="input text-sm" data-k="input-text-sm">
  <input class="input text-xs" data-k="input-text-xs">
  <input type="date" class="input text-sm" data-k="date-text-sm">
  <input type="time" class="input text-sm" data-k="time-text-sm">
  <input type="date" data-k="date-inherit">
  <input type="search" data-k="search-inherit">
  <input data-k="notype-inherit">
  <select class="input text-xs" data-k="select-text-xs"><option>가</option></select>
  <textarea class="text-sm" data-k="textarea-text-sm"></textarea>
  <input class="input text-2xl" data-k="input-text-2xl">
</div>`;

async function probeFontSizes(page: Page): Promise<Record<string, number>> {
    return page.evaluate((html) => {
        document.getElementById('zoom-probe')?.remove();
        document.body.insertAdjacentHTML('beforeend', html);
        const out: Record<string, number> = {};
        document.querySelectorAll<HTMLElement>('#zoom-probe [data-k]').forEach((el) => {
            out[el.dataset.k as string] = parseFloat(getComputedStyle(el).fontSize);
        });
        return out;
    }, PROBE_HTML);
}

test.describe('입력칸 포커스 확대 방지', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/faq');
        await expect(page.getByPlaceholder(/궁금하신가요/).first()).toBeVisible({ timeout: 15000 });
    });

    test('모바일에서는 모든 입력칸 글자가 16px 이상이고 포커스해도 확대되지 않는다', async ({ page }, testInfo) => {
        test.skip(!testInfo.project.name.startsWith('mobile'), '모바일 프로젝트 전용');

        for (const mode of ['', 'font-small', 'font-large']) {
            await page.evaluate((m) => {
                document.documentElement.classList.remove('font-small', 'font-large');
                if (m) document.documentElement.classList.add(m);
            }, mode);
            const sizes = await probeFontSizes(page);
            for (const [key, px] of Object.entries(sizes)) {
                expect(px, `${mode || '보통'} 모드 ${key}`).toBeGreaterThanOrEqual(16);
            }
            // 큰 글씨 유틸리티는 16px로 깎이지 않는다
            expect(sizes['input-text-2xl']).toBeGreaterThan(16);
        }
        await page.evaluate(() => document.documentElement.classList.remove('font-small', 'font-large'));

        // 실제 화면의 검색칸(text-sm)에 포커스한 뒤에도 배율이 1이어야 한다
        const search = page.getByPlaceholder(/궁금하신가요/).first();
        expect(parseFloat(await search.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
        await search.tap();
        await expect(search).toBeFocused();
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    });

    test('데스크톱에서는 입력칸 글자 밀도를 바꾸지 않는다', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name.startsWith('mobile'), '데스크톱 프로젝트 전용');

        const sizes = await probeFontSizes(page);
        // @theme의 text-sm 15px·text-xs 13px 그대로
        expect(sizes['input-text-sm']).toBe(15);
        expect(sizes['input-text-xs']).toBe(13);
        expect(sizes['select-text-xs']).toBe(13);
    });
});
