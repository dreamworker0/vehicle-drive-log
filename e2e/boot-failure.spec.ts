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
     * 회선 단절·복구를 **Playwright 인터셉션 없이** 표현한다 — 프리뷰 서버가 테스트
     * 쿠키(vdl-e2e-outage)를 보고 엔트리 청크에 진짜 503을 주고(vite.config.js의
     * e2eEntryOutage), 복구는 쿠키 삭제다.
     *
     * 인터셉션으로 돌아가면 안 되는 이유 — 네 가지 방식이 mobile-safari에서만 전부
     * 실패했다(2026-08-09 CI, 각 3회 재시도 모두 동일):
     *  1. 플래그 내리고 같은 핸들러에서 `route.continue()` — 재시도 후 앱이 안 뜨고,
     *     클릭 도중 `element was detached from the DOM`까지 발생.
     *  2. `page.unroute(url, handler)`로 가로채기 해제 — 리로드는 정상인데 청크 요청이
     *     `Blocked by Web Inspector`로 계속 실패.
     *  3. `page.unrouteAll()`로 전부 해제 — 2와 동일.
     *  4. 가로채기를 유지한 채 offline이면 `fulfill(503)`, 복구 후엔 `route.fetch()`로
     *     실제 응답을 fulfill — 리로드 후 청크 **재요청 자체가 0건**. fulfill로 만든
     *     실패가 인터셉션 계층에 남아, 리로드된 페이지가 네트워크에 나가보지도 않고
     *     실패를 재사용했다.
     *
     * 공통 원인이 "WebKit은 인터셉션 상태 변화(해제·응답 교체)를 리로드에 반영하지
     * 않는다"이므로, 실패 주입을 서버로 옮겨 브라우저가 평범한 HTTP(503 no-store →
     * 리로드 → 200)만 겪게 한다. 서버가 잠깐 응답하지 못하는 상황이라 현장에서 흔한
     * 실패 모양 그대로이고, 브라우저별 인터셉션 차이를 원천적으로 타지 않으므로
     * WebKit에서도 "복구 후 진입"까지 검증을 유지한다 — 회선이 불안정한 현장이 정확히
     * 이 앱의 사용 환경이라 iOS만 공백으로 둘 수 없다.
     *
     * 복구는 쿠키 삭제가 아니라 **서버 측 토글**(/__e2e/outage/off)로 표현한다.
     * 쿠키 삭제만으로는 "브라우저가 리로드 요청에 쿠키 변경을 반영했는가"라는 또 하나의
     * 브라우저 의존이 생긴다(5번째 시도가 이것으로 mobile-safari에서 실패했을 가능성).
     * 서버가 토큰을 무시하게 만들면 쿠키가 남아 있어도 정상 응답한다.
     */
    test('다시 시도를 누르면 재로드하고, 회선이 돌아오면 정상 진입한다', async ({ page, context, baseURL }, testInfo) => {
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
        // 리로드 후 import가 왜 실패했는지는 main.tsx의 console.error에만 남는다
        const consoleErrors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        // 회선 단절 — 쿠키(값=토큰)는 이 컨텍스트의 요청에만 실리므로 병렬 워커와
        // 간섭하지 않는다. 토큰은 서버 로그에서 이 테스트의 요청만 골라내는 데도 쓴다.
        const startedAt = new Date().toISOString();
        const outageToken = `w${testInfo.workerIndex}-r${testInfo.retry}`;
        await context.addCookies([
            { name: 'vdl-e2e-outage', value: outageToken, url: baseURL ?? 'http://localhost:4173' },
        ]);

        await page.goto('/', { waitUntil: 'commit' });
        await expect(page.getByText('앱을 불러오지 못했습니다')).toBeVisible({ timeout: 15000 });

        // 회선 복구 — 서버가 이 토큰을 무시하게 만든다(위 주석 참고). 쿠키도 지워
        // 실제 복구 상황(더 이상 아무 표식이 없는 평범한 요청)에 가깝게 둔다.
        await page.request.get(`/__e2e/outage/off?token=${outageToken}`);
        await context.clearCookies();

        await page.getByRole('button', { name: '다시 시도' }).click();

        // 버튼이 실제로 리로드를 일으키는지 — 모든 브라우저에서 확인한다
        await expect.poll(() => navigations.length, { timeout: 15000 }).toBeGreaterThan(1);

        // 랜딩이 실제로 뜨는지 — 접근성 스펙이 보는 것과 같은 앵커를 쓴다
        try {
            await expect(page.locator('nav[aria-label]').first()).toBeAttached({ timeout: 15000 });
        } catch (err) {
            const screenText = await page
                .evaluate(() => document.body.innerText)
                .catch(() => '(읽지 못함)');
            // 서버 관점의 기록 — 브라우저 이벤트는 캐시 재사용과 미요청을 구분하지 못한다
            const serverLog = await page.request
                .get('/__e2e/outage/log')
                .then(async (res) => {
                    const all = (await res.json()) as { at: string; url: string; token: string | null; status: number }[];
                    // 토큰 없는 항목은 병렬 테스트의 정상 요청일 수 있어 이 테스트 시작 이후로 좁힌다
                    return all
                        .filter((h) => h.token === outageToken || (h.token === null && h.at >= startedAt))
                        .slice(-20)
                        .map((h) => `${h.at} ${h.status} ${chunkName(h.url)} (token=${h.token ?? '없음'})`);
                })
                .catch((e) => [`(로그 조회 실패: ${(e as Error).message})`]);
            throw new Error(
                `랜딩이 뜨지 않았다.\n`
                + `  메인 프레임 이동 ${navigations.length}회: ${navigations.join(' → ') || '(없음)'}\n`
                + `  페이지 예외: ${pageErrors.join(' / ') || '(없음)'}\n`
                + `  엔트리 청크 요청(브라우저 관점): ${chunkResults.join(' / ') || '(없음)'}\n`
                + `  엔트리 청크 요청(서버 관점):\n    ${serverLog.join('\n    ') || '(없음)'}\n`
                + `  콘솔 에러: ${consoleErrors.join(' / ') || '(없음)'}\n`
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
