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

    /**
     * 회선 복구를 **가로채기 해제(unroute)** 로 표현한다.
     *
     * 예전에는 플래그를 내리고 같은 핸들러에서 `route.continue()`로 흘려보냈는데,
     * WebKit(mobile-safari)에서만 재시도 후 앱이 뜨지 않았다(2026-08-09 CI). 3회 시도 중
     * 한 번은 클릭 도중 `element was detached from the DOM`까지 떴다 — 가로챈 요청을
     * 리로드 경로에서 이어보내는 처리가 Chromium과 다르다는 뜻이다. 한동안 WebKit에서
     * 이 스펙을 건너뛰었지만, 그러면 **iOS에서 "다시 시도" 복구가 되는지 아무도 확인하지
     * 못한다** — 회선이 불안정한 현장이 정확히 이 앱의 사용 환경이라 그대로 둘 수 없었다.
     *
     * `unroute`는 가로채기 자체를 걷어내므로 리로드 요청이 서버로 곧장 간다. 실제 회선
     * 복구에 더 가깝고, 브라우저별 인터셉션 차이를 타지 않는다.
     */
    test('다시 시도를 누르면 재로드하고, 회선이 돌아오면 정상 진입한다', async ({ page }) => {
        // 이 스펙은 브라우저마다 결과가 갈리는 자리라(청크 실패 → 리로드 → 복구),
        // "랜딩이 안 떴다"만으로는 리로드가 아예 없었는지·리로드는 됐는데 앱이 안 떴는지
        // 구분할 수 없다. CI 로그를 뒤지는 왕복을 없애려고 그 정보를 실패 메시지에 싣는다.
        const navigations: string[] = [];
        const pageErrors: string[] = [];
        page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame()) navigations.push(frame.url());
        });
        page.on('pageerror', (err) => pageErrors.push(err.message));

        const block = (route: import('@playwright/test').Route) => route.abort('failed');
        await page.route(ENTRY_CHUNK, block);

        await page.goto('/', { waitUntil: 'commit' });
        await expect(page.getByText('앱을 불러오지 못했습니다')).toBeVisible({ timeout: 15000 });

        // 회선 복구 — 가로채기를 완전히 해제한다(위 주석 참고)
        await page.unroute(ENTRY_CHUNK, block);

        await page.getByRole('button', { name: '다시 시도' }).click();

        // 랜딩이 실제로 뜨는지 — 접근성 스펙이 보는 것과 같은 앵커를 쓴다
        try {
            await expect(page.locator('nav[aria-label]').first()).toBeAttached({ timeout: 15000 });
        } catch (err) {
            const screenText = await page
                .evaluate(() => document.body.innerText)
                .catch(() => '(읽지 못함)');
            throw new Error(
                `랜딩이 뜨지 않았다.\n`
                + `  메인 프레임 이동 ${navigations.length}회: ${navigations.join(' → ') || '(없음)'}\n`
                + `  페이지 예외: ${pageErrors.join(' / ') || '(없음)'}\n`
                + `  화면 텍스트: "${screenText.replace(/\s+/g, ' ').slice(0, 200)}"\n`
                + `  원래 오류: ${(err as Error).message}`,
            );
        }
        await expect(page.getByText('앱을 불러오지 못했습니다')).toHaveCount(0);
    });

    test('정상 회선에서는 실패 화면이 뜨지 않는다', async ({ page }) => {
        // 위 두 검사가 항상 통과하는 화면을 보고 있는 것은 아닌지 확인한다
        await page.goto('/', { waitUntil: 'commit' });

        await expect(page.locator('nav[aria-label]').first()).toBeAttached({ timeout: 15000 });
        await expect(page.getByText('앱을 불러오지 못했습니다')).toHaveCount(0);
    });
});
