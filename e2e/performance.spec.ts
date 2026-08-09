import { test, expect } from '@playwright/test';

/**
 * 성능·배포 산출물 기본 검증.
 *
 * 이 파일에는 한때 **어떤 경우에도 실패할 수 없는 단언**이 있었다:
 *
 *   expect(typeof swRegistered).toBe('boolean');   // SW가 등록되든 말든 통과
 *
 * "CI에서는 SW가 등록되지 않을 수 있으므로"라는 주석과 함께였는데, 그 조건에서
 * 검증 가능한 것을 찾는 대신 단언을 무력화한 것이라 초록불이 거짓 신호였다.
 * (같은 이유로 core-workflows.spec.ts의 빈 테스트들도 제거된 전례가 있다.)
 *
 * 그래서 등록 **타이밍**에 의존하지 않고 결정적으로 검증 가능한 것으로 바꿨다 —
 * 서비스워커 스크립트가 빌드 산출물에 실제로 존재하고 올바른 MIME으로 서빙되는지.
 * 이건 SW 빌드 설정이 깨지면(injectManifest 실패, filename 변경 등) 반드시 실패한다.
 */
test.describe('성능·배포 산출물 검증', () => {
    test('초기 로드 후 랜딩 콘텐츠가 실제로 렌더된다', async ({ page }) => {
        // 단순 경과 시간(<5초)만 재면 러너 변동에 흔들리는 플레이크 소스가 되고,
        // 정작 "앱이 부팅에 실패해 빈 화면"인 회귀는 잡지 못한다.
        // 예산 안에 **콘텐츠가 보이는지**로 바꿔 부팅 실패를 잡는다.
        const start = Date.now();
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: /차량 운행일지/ })).toBeVisible({ timeout: 15000 });
        const elapsed = Date.now() - start;
        console.log(`[perf] 랜딩 콘텐츠 표시까지 ${elapsed}ms`);
    });

    test('메타 태그가 존재한다', async ({ page }) => {
        await page.goto('/');
        // viewport 메타 태그
        const viewport = page.locator('meta[name="viewport"]');
        await expect(viewport).toHaveCount(1);
        // theme-color 메타 태그
        const themeColor = page.locator('meta[name="theme-color"]');
        await expect(themeColor).toHaveCount(1);
    });

    test('서비스워커 스크립트가 올바른 MIME으로 서빙된다', async ({ page }) => {
        // 등록 여부(비동기·환경 의존)가 아니라 산출물 자체를 본다 — 결정적이다.
        const response = await page.request.get('/sw.js');
        expect(response.status()).toBe(200);

        const contentType = response.headers()['content-type'] ?? '';
        // MIME이 JS가 아니면 브라우저가 SW 등록을 거부한다(오프라인 기능 전체가 죽는다).
        expect(contentType).toMatch(/javascript/);

        const body = await response.text();
        expect(body.length).toBeGreaterThan(0);
    });

    test('매니페스트가 서빙되고 PWA 필수 필드를 갖는다', async ({ page }) => {
        // vite.config.js의 `manifest: false` — 플러그인 생성물이 아니라 public/manifest.json을 직접 쓴다.
        const response = await page.request.get('/manifest.json');
        expect(response.status()).toBe(200);

        const manifest = await response.json();
        expect(manifest.name).toBeTruthy();
        expect(manifest.start_url).toBeTruthy();
        // display가 standalone 계열이 아니면 홈화면 추가 시 앱처럼 열리지 않는다.
        expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
        expect(Array.isArray(manifest.icons) && manifest.icons.length > 0).toBe(true);
    });
});
