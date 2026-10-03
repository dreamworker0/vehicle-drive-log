import { test, expect, type Page } from '@playwright/test';
import { TEST_ADMIN } from './emulator/seed';

/**
 * 기관 관리자가 마지막에 쓴 화면으로 앱을 다시 여는 여정 E2E (에뮬레이터 전용).
 *
 * 폰 PWA에서 [직원 화면]으로 운행을 기록하고 나중에 다시 열면, 시작 주소(`/`)가 역할만 보고
 * 항상 관리자 화면으로 보냈다(2026-10-03 사용자 요청). 앱을 다시 여는 것은 `/`로 새로 들어오는
 * 것과 같으므로 page.goto('/')로 재현한다.
 */

declare global {
    interface Window {
        __E2E_AUTH__?: {
            signIn: (email: string, password: string) => Promise<unknown>;
            signOut: () => Promise<void>;
        };
    }
}

async function signIn(page: Page, email: string, password: string) {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__E2E_AUTH__, null, { timeout: 15000 });
    await page.evaluate(
        ([e, p]) => { void window.__E2E_AUTH__!.signIn(e, p); },
        [email, password] as const,
    ).catch(() => { /* 네비게이션으로 인한 컨텍스트 파괴 무시 */ });
}

test.describe('관리자 마지막 화면 기억 (에뮬레이터)', () => {
    test('직원 화면을 쓰다 앱을 다시 열면 직원 화면, 관리자 화면으로 돌아가면 다시 관리자 화면', async ({ page }) => {
        await signIn(page, TEST_ADMIN.email, TEST_ADMIN.password);
        // 처음에는 기존과 같이 관리자 화면으로 연다
        await page.waitForURL(/\/admin/, { timeout: 25000 });

        // 직원 화면으로 넘어가 사용한다 — 주소만이 아니라 **화면이 뜬 것**까지 기다린다.
        // 기억은 화면(레이아웃)이 그려질 때 남으므로, 주소만 보고 넘어가면 기록 전에 다시 연다.
        await page.goto('/employee');
        await expect(page.getByTitle('관리자 화면으로 전환')).toBeVisible({ timeout: 20000 });

        // 앱을 다시 연다 — 시작 주소로 새로 들어온다
        await page.goto('/');
        await page.waitForURL(/\/employee/, { timeout: 20000 });
        expect(new URL(page.url()).pathname).toMatch(/^\/employee/);

        // 관리자 화면으로 돌아가 사용하면 다음에는 관리자 화면으로 연다
        await page.goto('/admin');
        await expect(page.getByTitle('직원 화면으로 전환')).toBeVisible({ timeout: 20000 });
        await page.goto('/');
        await page.waitForURL(/\/admin/, { timeout: 20000 });
        expect(new URL(page.url()).pathname).toMatch(/^\/admin/);
    });
});
