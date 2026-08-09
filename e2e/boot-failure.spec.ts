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

/** 로그를 짧게 유지하려고 해시 앞부분만 남긴다 */
function chunkName(url: string): string {
    return url.split('/').pop() ?? url;
}

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
     * 회선 복구를 **가로채기를 유지한 채 직접 응답을 만들어 주는 것**으로 표현한다.
     *
     * 이렇게 돌아온 이유(전부 2026-08-09 CI, mobile-safari에서만):
     *  1. 플래그 내리고 `route.continue()` — 재시도 후 앱이 안 뜨고, 클릭 도중
     *     `element was detached from the DOM`까지 발생.
     *  2. `unroute`/`unrouteAll`로 가로채기 해제 — 리로드는 정상(메인 프레임 이동 2회,
     *     예외 없음)인데 청크 요청이 `Blocked by Web Inspector`로 계속 실패했다.
     *     즉 WebKit에서는 **해제가 리로드된 페이지에 반영되지 않는다.** 제품이 아니라
     *     Playwright×WebKit 인터셉션 계층의 한계임이 이 오류 문자열로 확정됐다.
     *
     * 그래서 가로채기는 끝까지 유지하되, 복구 후에는 핸들러가 `route.fetch()`로 실제
     * 응답을 받아 `fulfill`한다. 요청이 브라우저 네트워크 스택의 해제 반영에 의존하지
     * 않으므로 브라우저별 차이를 타지 않고, 사용자 입장의 시나리오(같은 URL이 이번엔
     * 성공한다)도 그대로다. WebKit에서 이 스펙을 건너뛰면 **iOS에서 "다시 시도" 복구가
     * 되는지 아무도 확인하지 못한다** — 회선이 불안정한 현장이 정확히 이 앱의 사용
     * 환경이라 공백으로 둘 수 없다.
     */
    test('다시 시도를 누르면 재로드하고, 회선이 돌아오면 정상 진입한다', async ({ page }) => {
        // 이 스펙은 브라우저마다 결과가 갈리는 자리라(청크 실패 → 리로드 → 복구),
        // "랜딩이 안 떴다"만으로는 리로드가 아예 없었는지·리로드는 됐는데 앱이 안 떴는지
        // 구분할 수 없다. CI 로그를 뒤지는 왕복을 없애려고 그 정보를 실패 메시지에 싣는다.
        const navigations: string[] = [];
        const pageErrors: string[] = [];
        // 엔트리 청크 요청이 복구 후에도 실패하는지 = 회선 복구가 실제로 반영됐는지의 지표
        const chunkResults: string[] = [];
        page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame()) navigations.push(frame.url());
        });
        page.on('pageerror', (err) => pageErrors.push(err.message));
        page.on('response', (res) => {
            if (ENTRY_CHUNK.test(res.url())) chunkResults.push(`${res.status()} ${chunkName(res.url())}`);
        });
        page.on('requestfailed', (req) => {
            if (ENTRY_CHUNK.test(req.url())) {
                chunkResults.push(`실패(${req.failure()?.errorText ?? '?'}) ${chunkName(req.url())}`);
            }
        });

        let online = false;
        await page.route(ENTRY_CHUNK, async (route) => {
            if (!online) {
                await route.abort('failed');
                return;
            }
            // 복구 후: 인터셉션 안에서 직접 요청을 수행해 그 응답으로 채운다(위 주석 참고)
            const response = await route.fetch();
            await route.fulfill({ response });
        });

        await page.goto('/', { waitUntil: 'commit' });
        await expect(page.getByText('앱을 불러오지 못했습니다')).toBeVisible({ timeout: 15000 });

        // 회선 복구
        online = true;

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
                + `  엔트리 청크 요청: ${chunkResults.join(' / ') || '(없음)'}\n`
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
