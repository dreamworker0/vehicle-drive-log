import { defineConfig } from '@playwright/test';

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
});
