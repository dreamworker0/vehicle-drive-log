import { test, expect } from '@playwright/test';

test.describe('오프라인 큐잉 & PWA', () => {
    // 오프라인 배너·큐잉·재접속 동기화 시나리오는 인증 세션 위에서 실계약을 검증하는
    // e2e/authed-offlineSync.spec.ts(에뮬레이터 E2E, CI 게이트)로 이관 완료.
    // 이 파일은 비인증 스모크로 SW 등록·manifest만 검증한다.

    test('서비스 워커가 등록·활성화된다', async ({ page }) => {
        // SW는 프로덕션 빌드에만 있다. vite.config.js의 VitePWA에 devOptions가 없어 개발 서버
        // (`npm run dev`, 로컬 기본값)에서는 registerSW()가 아무것도 등록하지 않는다. CI는
        // playwright.config.js가 빌드 결과를 `vite preview`로 띄우므로 거기서만 검사한다.
        test.skip(!process.env.CI, '개발 서버는 SW를 등록하지 않는다 — 빌드 결과(vite preview)에서만 검사');

        await page.goto('/');

        // 예전 검사(`navigator.serviceWorker?.ready !== undefined`)는 SW 지원 브라우저면 늘 참이라
        // 등록이 깨져도 통과했다. 실제 등록 건수와 활성 워커를 본다.
        await expect
            .poll(
                () => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
                { timeout: 15_000 },
            )
            .toBeGreaterThan(0);

        const activeScript = await page.evaluate(
            async () => (await navigator.serviceWorker.ready).active?.scriptURL ?? null,
        );
        expect(activeScript).toMatch(/\/sw\.js$/);
    });

    test('manifest.json이 올바른 필드를 포함한다', async ({ page }) => {
        const response = await page.goto('/manifest.json');
        expect(response?.status()).toBe(200);
        const manifest = await response?.json();
        expect(manifest.name).toBeTruthy();
        expect(manifest.short_name).toBeTruthy();
        expect(manifest.start_url).toBeTruthy();
        expect(manifest.icons?.length).toBeGreaterThan(0);
    });

});
