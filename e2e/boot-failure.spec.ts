import { test, expect } from '@playwright/test';

/**
 * 엔트리 번들을 못 받았을 때 사용자가 무엇을 보는지 고정한다.
 *
 * 엔트리 로드가 실패하면 React가 아예 마운트되지 않으므로 ErrorBoundary가 낄 자리가 없다.
 * main.tsx에 catch가 없던 동안에는 "로딩 중..." 화면이 그대로 남아, 회선이 불안정한
 * 환경의 사용자에게는 앱이 죽은 것처럼 보였다. 이 스펙은 그 상태로 되돌아가지 않게 막는다.
 *
 * 비인증 첫 진입은 lightEntry와 그것이 정적으로 끌어오는 LandingPage 청크를 받아야 하므로,
 * 둘 중 하나만 막아도 부팅이 실패한다.
 */
const ENTRY_CHUNK = /\/assets\/(lightEntry|LandingPage)-[^/]*\.js$/;

test.describe('부팅 실패 처리', () => {
    test('엔트리 청크를 못 받으면 다시 시도 화면을 보여준다', async ({ page }) => {
        await page.route(ENTRY_CHUNK, (route) => route.abort('failed'));

        await page.goto('/', { waitUntil: 'commit' });

        await expect(page.getByText('앱을 불러오지 못했습니다')).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
        // 로딩 스피너가 남아 있으면 "멈춘 화면"과 구분이 안 된다
        await expect(page.getByText('로딩 중...')).toHaveCount(0);
    });

    test('다시 시도를 누르면 재로드하고, 회선이 돌아오면 정상 진입한다', async ({ page }) => {
        let block = true;
        await page.route(ENTRY_CHUNK, (route) => (block ? route.abort('failed') : route.continue()));

        await page.goto('/', { waitUntil: 'commit' });
        await expect(page.getByText('앱을 불러오지 못했습니다')).toBeVisible({ timeout: 15000 });

        block = false;
        await page.getByRole('button', { name: '다시 시도' }).click();

        // 랜딩이 실제로 뜨는지 — 접근성 스펙이 보는 것과 같은 앵커를 쓴다
        await expect(page.locator('nav[aria-label]').first()).toBeAttached({ timeout: 15000 });
        await expect(page.getByText('앱을 불러오지 못했습니다')).toHaveCount(0);
    });

    test('정상 회선에서는 실패 화면이 뜨지 않는다', async ({ page }) => {
        // 위 두 검사가 항상 통과하는 화면을 보고 있는 것은 아닌지 확인한다
        await page.goto('/', { waitUntil: 'commit' });

        await expect(page.locator('nav[aria-label]').first()).toBeAttached({ timeout: 15000 });
        await expect(page.getByText('앱을 불러오지 못했습니다')).toHaveCount(0);
    });
});
