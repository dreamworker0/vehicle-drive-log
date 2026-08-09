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
     * ## WebKit에서는 "복구 후 진입"까지 검증하지 않는다 — 시뮬레이션의 한계
     *
     * "회선이 끊겼다가 돌아온다"를 표현하는 방법을 네 가지 시도했고, mobile-safari에서만
     * 전부 실패했다(2026-08-09 CI, 각 3회 재시도 모두 동일):
     *  1. 플래그를 내리고 같은 핸들러에서 `route.continue()`
     *  2. `page.unroute(url, handler)`로 가로채기 해제
     *  3. `page.unrouteAll()`로 전부 해제
     *  4. 가로채기를 유지한 채 `route.fetch()` + `fulfill`로 실제 응답 주입
     *
     * 스펙에 심어 둔 진단이 원인을 확정해 줬다. 실패 시점의 상태는 매번:
     *   메인 프레임 이동 2회 / 페이지 예외 없음 /
     *   엔트리 청크 요청: 실패(Blocked by Web Inspector) ×2  ← **리로드분 요청이 0건**
     * 즉 **제품은 정상 동작했다**(다시 시도 → 리로드 수행). 다만 WebKit은 인스펙터가 한 번
     * 끊은 URL을 그 상태로 붙들고 있어, 리로드해도 재요청 자체를 하지 않는다. 테스트가
     * 무슨 수를 써도 "이번엔 성공한다"를 그 URL에 대해 표현할 수 없다는 뜻이다.
     *
     * 그래서 iOS에서 확인할 수 있는 데까지만 확인한다 — **실패 화면이 뜨고, 다시 시도가
     * 실제로 리로드를 일으키는 것**까지. 우리 코드가 회귀할 수 있는 부분은 여기이고
     * (버튼 핸들러·`showBootError`), 그 뒤 "받아온 청크로 앱이 뜬다"는 브라우저 공통
     * 동작이라 Chromium 계열에서 검증한다. 건너뛰는 것이 아니라 **브라우저가 표현할 수
     * 있는 범위로 좁히는 것**이며, 회선이 불안정한 현장이 이 앱의 사용 환경인 만큼
     * 전부 포기하지는 않는다.
     */
    test('다시 시도를 누르면 재로드하고, 회선이 돌아오면 정상 진입한다', async ({ page, browserName }) => {
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
                // `route.abort()`가 아니라 **503 응답**으로 끊는다.
                // abort는 WebKit에 `Blocked by Web Inspector`로 기록되고, 그 뒤 리로드하면
                // 브라우저가 **재요청 자체를 하지 않는다**(2026-08-09 CI: 리로드 후 청크 요청
                // 이벤트 0건). 실패한 URL이 그대로 캐시에 남아 복구를 표현할 방법이 없어진다.
                // 503은 실제 HTTP 응답이라 그 경로를 타지 않고, no-store로 캐시도 막는다.
                // 서버가 잠깐 응답하지 못하는 상황이라 현장에서 더 흔한 실패 모양이기도 하다.
                await route.fulfill({ status: 503, headers: { 'cache-control': 'no-store' }, body: '' });
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

        // 버튼이 실제로 리로드를 일으키는지 — 모든 브라우저에서 확인한다
        await expect.poll(() => navigations.length, { timeout: 15000 }).toBeGreaterThan(1);

        if (browserName === 'webkit') {
            // 여기까지가 WebKit이 표현할 수 있는 범위다(위 주석 참고).
            // 이후 상태를 로그로 남겨, 나중에 이 분기를 지워도 되는지 판단할 근거를 만든다.
            console.log(`[boot-failure/webkit] 리로드 후 엔트리 청크 요청: ${chunkResults.join(' / ') || '(없음)'}`);
            return;
        }

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
