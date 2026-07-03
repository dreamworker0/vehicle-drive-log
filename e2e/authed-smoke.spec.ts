import { test, expect, type Page } from '@playwright/test';
import { TEST_ADMIN, TEST_EMPLOYEE } from './emulator/seed';

/**
 * 인증 상태 E2E (에뮬레이터 전용 — playwright.emulator.config.ts).
 *
 * Google 로그인 전용 앱이라 OAuth 팝업을 자동화할 수 없으므로, 에뮬레이터 모드에서
 * 앱이 window에 노출하는 __E2E_AUTH__.signIn(이메일/비번)으로 실제 로그인 세션을 만든다.
 * 그러면 useAuth의 onAuthStateChanged → users 구독 → claims 갱신이 정상 동작하고,
 * 랜딩(requireGuest)에서 역할별 대시보드로 자동 리다이렉트된다.
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
    // 에뮬레이터 모드에서 로그인 헬퍼가 window에 노출될 때까지 대기
    await page.waitForFunction(() => !!window.__E2E_AUTH__, null, { timeout: 15000 });
    // 로그인 트리거만 하고 반환 promise는 기다리지 않는다.
    // 로그인 성공 즉시 requireGuest 가드가 리다이렉트를 일으켜 evaluate 컨텍스트가
    // 파괴될 수 있으므로, 결과는 호출부의 waitForURL로 확인한다.
    await page.evaluate(
        ([e, p]) => { void window.__E2E_AUTH__!.signIn(e, p); },
        [email, password] as const,
    ).catch(() => { /* 네비게이션으로 인한 컨텍스트 파괴 무시 */ });
}

test.describe('인증 상태 E2E (에뮬레이터)', () => {
    test('직원 로그인 시 직원 대시보드로 자동 진입한다', async ({ page }) => {
        await signIn(page, TEST_EMPLOYEE.email, TEST_EMPLOYEE.password);
        await page.waitForURL(/\/employee/, { timeout: 25000 });
        await expect(page).toHaveURL(/\/employee/);
    });

    test('관리자 로그인 시 관리자 화면으로 자동 진입한다', async ({ page }) => {
        await signIn(page, TEST_ADMIN.email, TEST_ADMIN.password);
        await page.waitForURL(/\/admin/, { timeout: 25000 });
        await expect(page).toHaveURL(/\/admin/);
    });

    test('직원이 관리자 전용 화면에 접근하면 직원 화면으로 돌려보낸다', async ({ page }) => {
        await signIn(page, TEST_EMPLOYEE.email, TEST_EMPLOYEE.password);
        await page.waitForURL(/\/employee/, { timeout: 25000 });
        // 권한 없는 /admin 직접 접근 → AuthGuard가 /employee로 리다이렉트.
        // 가드 리다이렉트가 네비게이션 도중 발동하면 goto가 net::ERR_ABORTED로 중단될 수 있으므로
        // 이를 허용하고, 최종 URL 단언으로 리다이렉트 결과를 검증한다(signIn의 catch와 동일 이유).
        await page.goto('/admin').catch(() => { /* 리다이렉트로 인한 네비게이션 중단 무시 */ });
        await expect(page).toHaveURL(/\/employee/, { timeout: 15000 });
    });
});
