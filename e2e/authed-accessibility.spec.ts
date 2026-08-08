import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { TEST_ADMIN, TEST_EMPLOYEE } from './emulator/seed';

/**
 * 인증 화면 axe-core 접근성 검사 (에뮬레이터 전용 — playwright.emulator.config.ts).
 *
 * accessibility-axe.spec.ts는 비인증 공개 5개 페이지만 검사한다 — 정작 사용자가
 * 매일 쓰는 운행일지 폼·예약 캘린더·대시보드는 게이트가 없었다. 여기서 인증 후
 * 핵심 화면에 같은 기준(serious/critical 0건, color-contrast는 리포트 전용)을 적용한다.
 *
 * 읽기 전용 검사만 수행한다 — 인증 E2E는 시드 상태(사용자·차량·현재 km)를 공유하므로
 * 여기서 데이터를 쓰면 다른 authed-* 테스트의 전제가 흔들린다.
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
    // 로그인 성공 즉시 requireGuest 가드가 리다이렉트를 일으켜 evaluate 컨텍스트가
    // 파괴될 수 있으므로 반환 promise는 기다리지 않는다 (authed-smoke와 동일 패턴).
    await page.evaluate(
        ([e, p]) => { void window.__E2E_AUTH__!.signIn(e, p); },
        [email, password] as const,
    ).catch(() => { /* 네비게이션으로 인한 컨텍스트 파괴 무시 */ });
}

// 게이트에서 제외하되 리포트는 유지하는 규칙 (accessibility-axe.spec.ts와 동일한 디자인 부채).
const REPORT_ONLY_RULES = new Set(['color-contrast']);

async function expectNoSeriousViolations(page: Page, label: string) {
    // SPA 라우트 렌더·데이터 로드가 끝난 뒤 검사 (레이아웃 미완성 상태의 오탐 방지)
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .exclude('iframe')
        .analyze();

    const seriousOrCritical = result.violations.filter(
        ({ impact }) => impact === 'serious' || impact === 'critical',
    );
    const blocking = seriousOrCritical.filter((v) => !REPORT_ONLY_RULES.has(v.id));
    const reportOnly = seriousOrCritical.filter((v) => REPORT_ONLY_RULES.has(v.id));

    if (reportOnly.length > 0) {
        console.log(
            `[axe] ${label} 색상 대비 부채(게이트 제외): ` +
                reportOnly.map((v) => `${v.id} ${v.nodes.length}건`).join(', '),
        );
    }
    if (blocking.length > 0) {
        console.log(
            `[axe] ${label} 게이트 위반:\n` +
                blocking
                    .map((v) => `  - ${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.html).join('\n    ')}`)
                    .join('\n'),
        );
    }
    expect(blocking).toEqual([]);
}

test.describe('인증 화면 접근성 (axe)', () => {
    test('직원 핵심 화면(오늘의 운행·운행일지 폼·예약 캘린더)에 serious·critical 위반이 없다', async ({ page }) => {
        await signIn(page, TEST_EMPLOYEE.email, TEST_EMPLOYEE.password);
        await page.waitForURL(/\/employee/, { timeout: 25000 });
        await expectNoSeriousViolations(page, '/employee/today');

        // 가드 리다이렉트 중 goto가 중단될 수 있어 catch로 허용 (authed-smoke와 동일 이유)
        await page.goto('/employee/drive-log').catch(() => { /* 네비게이션 중단 무시 */ });
        await expect(page).toHaveURL(/drive-log/, { timeout: 15000 });
        await expectNoSeriousViolations(page, '/employee/drive-log');

        await page.goto('/employee/reservations').catch(() => { /* 네비게이션 중단 무시 */ });
        await expect(page).toHaveURL(/reservations/, { timeout: 15000 });
        await expectNoSeriousViolations(page, '/employee/reservations');
    });

    test('관리자 대시보드에 serious·critical 위반이 없다', async ({ page }) => {
        await signIn(page, TEST_ADMIN.email, TEST_ADMIN.password);
        await page.waitForURL(/\/admin/, { timeout: 25000 });
        await expectNoSeriousViolations(page, '/admin/dashboard');
    });
});
