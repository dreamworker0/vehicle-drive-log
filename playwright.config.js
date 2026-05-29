import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
    testDir: './e2e',
    testIgnore: /authed-.*\.spec\.ts/,
    timeout: 30000,
    retries: isCI ? 2 : 1,
    use: {
        baseURL: isCI ? 'http://localhost:4173' : 'http://localhost:5173',
        headless: true,
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: isCI ? 'npx vite preview --port 4173' : 'npm run dev',
        port: isCI ? 4173 : 5173,
        reuseExistingServer: !isCI,
    },
});
