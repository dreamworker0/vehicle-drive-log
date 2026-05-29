import { defineConfig } from '@playwright/test';

/**
 * 에뮬레이터 기반 인증 E2E 전용 설정.
 *
 * 실행: `npm run test:e2e:emulator`
 *   → firebase emulators:exec가 auth/firestore 에뮬레이터를 띄우고,
 *     그 안에서 이 설정으로 Playwright를 실행한다.
 *   → globalSetup이 admin SDK로 테스트 데이터를 시드한다.
 *   → webServer가 vite를 emulator 모드(VITE_USE_EMULATOR=true, .env.emulator)로 띄운다.
 *
 * 기본 playwright.config.js(비인증 스모크)와 분리해, 인증이 필요한 플로우만 여기서 다룬다.
 */
export default defineConfig({
    testDir: './e2e',
    testMatch: /authed-.*\.spec\.ts/,
    timeout: 45000,
    retries: 0,
    globalSetup: './e2e/emulator/global-setup.ts',
    use: {
        baseURL: 'http://127.0.0.1:5174',
        headless: true,
        screenshot: 'only-on-failure',
    },
    webServer: {
        // --host 127.0.0.1 로 IPv4에 명시 바인딩 (Windows에서 localhost가 ::1로 해석되어
        // baseURL(127.0.0.1)과 불일치하는 문제 방지)
        command: 'vite --mode emulator --port 5174 --strictPort --host 127.0.0.1',
        url: 'http://127.0.0.1:5174',
        reuseExistingServer: false,
        timeout: 60000,
    },
});
