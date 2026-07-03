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
    // CI에서 맨 처음 실행되는 테스트는 vite dev 서버의 온디맨드 콜드 컴파일(auth+라우팅+레이아웃
    // 전체 그래프)을 홀로 부담해 로그인→리다이렉트가 간헐적으로 25s를 초과한다(로컬은 앞선 테스트가
    // 서버를 예열해 통과). 제품 버그가 아닌 콜드스타트 타이밍이므로 CI에서만 재시도로 흡수한다.
    retries: process.env.CI ? 2 : 0,
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
