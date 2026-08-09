import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
    testDir: './e2e',
    testIgnore: /authed-.*\.spec\.ts/,
    timeout: 30000,
    retries: isCI ? 2 : 1,
    // 인증 E2E(playwright.emulator.config.ts)와 **출력 폴더를 분리한다.**
    // Playwright는 실행 시작 시 자기 outputDir를 지운다. 둘 다 기본값(test-results/)을 쓰면
    // 뒤에 도는 인증 E2E가 앞선 실패의 스크린샷·trace를 통째로 지워, 업로드 스텝이
    // "No files were found"로 끝난다 — **정작 실패했을 때만 증거가 사라진다.**
    // Phase 136에서 두 E2E가 서로의 실패에 묶이지 않고 각자 돌게 되면서 드러났다
    // (그전에는 앞이 실패하면 뒤가 skipped라 지워질 일이 없었다). ci.yml의 업로드 경로는
    // test-results/ 전체라 하위 폴더로 나누기만 하면 그대로 수집된다.
    outputDir: 'test-results/e2e',
    use: {
        baseURL: isCI ? 'http://localhost:4173' : 'http://localhost:5173',
        headless: true,
        screenshot: 'only-on-failure',
        // CI 실패 진단용 trace — 실패한 테스트만 남기고 아티팩트로 업로드된다(ci.yml)
        trace: isCI ? 'retain-on-failure' : 'off',
    },
    webServer: {
        command: isCI ? 'npx vite preview --port 4173' : 'npm run dev',
        port: isCI ? 4173 : 5173,
        reuseExistingServer: !isCI,
    },
    // ── 브라우저·뷰포트 프로젝트 ──
    // 여기 projects가 없어 **Chromium 데스크톱 단독**으로만 돌고 있었다. 이 앱은 PWA·오프라인·
    // IndexedDB가 핵심인데 그 셋은 WebKit에서 동작이 가장 많이 갈리는 영역이고, 실제로
    // src/lib/sentry.ts의 무시 목록 절반이 iOS Safari IndexedDB 예외다 — 프로덕션에서만
    // 드러나던 공백이라는 뜻이다.
    //
    // ⚠️ 실행 비용 때문에 CI에서 프로젝트를 나눠 돌린다(ci.yml / e2e-cross-browser.yml 주석 참고).
    //    로컬에서 `npx playwright test`를 그냥 돌리면 네 프로젝트가 모두 실행된다.
    //    특정 브라우저만 보려면 `npx playwright test --project=mobile-safari`.
    projects: [
        {
            // 지금까지의 유일한 실행 대상. 기본값이므로 동작이 달라지지 않는다.
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            // 실제 이용자의 다수가 안드로이드 폰이다. Chromium 바이너리를 공유하므로
            // 추가 다운로드 없이 뷰포트·터치·UA만 달라진다(가장 싼 프로젝트).
            name: 'mobile-chrome',
            use: { ...devices['Pixel 7'] },
        },
        {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
        },
        {
            // 이 프로젝트가 이번 확장의 핵심이다 — iOS Safari에서만 나던 오류를
            // 배포 전에 잡을 수 있는 유일한 자리.
            name: 'mobile-safari',
            use: { ...devices['iPhone 14'] },
        },
    ],
});
