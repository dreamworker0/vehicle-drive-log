import { test, expect, type Page } from '@playwright/test';
import { TEST_EMPLOYEE } from './emulator/seed';

/**
 * 자주 쓰는 운행 목적 E2E (에뮬레이터 전용 — playwright.emulator.config.ts).
 *
 * 더보기 › 자주 쓰는 목적에서 등록 → 운행일지 목적 칸 아래 단추로 채우기 →
 * 칸에 새로 적은 목적을 바로 저장하기까지, 실제 로그인 세션과 Firestore Rules를 거쳐 확인한다.
 * (단위 테스트는 Firestore와 로그인을 가짜로 바꾸므로 Rules 거부·캐시 갱신은 여기서만 드러난다.)
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

/** 로그인 직후 전체 리로드 이동은 인증 재초기화 중 가드가 되돌릴 수 있어, 안착할 때까지 재시도한다 */
async function gotoStable(page: Page, path: string) {
    await expect(async () => {
        await page.goto(path, { waitUntil: 'commit' }).catch(() => { /* 리다이렉트 중단 무시 */ });
        await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/')), { timeout: 3000 });
    }).toPass({ timeout: 25000 });
}

test.describe('자주 쓰는 운행 목적 (에뮬레이터)', () => {
    test('더보기에서 등록한 목적이 운행일지 목적 칸 아래 단추로 뜨고, 새 목적은 칸에서 바로 저장된다', async ({ page }) => {
        page.on('console', (msg) => {
            if (msg.type() === 'error') console.log('[browser error]', msg.text());
        });

        await signIn(page, TEST_EMPLOYEE.email, TEST_EMPLOYEE.password);
        await page.waitForURL(/\/employee/, { timeout: 25000 });

        // 1. 더보기 › 자주 쓰는 목적에서 등록
        await gotoStable(page, '/employee/purposes');
        await expect(page.getByRole('heading', { name: '자주 쓰는 목적' })).toBeVisible({ timeout: 15000 });
        await page.getByRole('button', { name: '+ 추가' }).click();
        await page.fill('input#new-purpose', '가정방문');
        await page.getByRole('button', { name: '목적 추가' }).click();
        await expect(page.getByText('가정방문', { exact: true })).toBeVisible({ timeout: 10000 });
        await page.screenshot({ path: 'test-results/authed/favorite-purposes-manager.png', fullPage: true });

        // 2. 운행일지 목적 칸 아래 단추로 채우기
        await gotoStable(page, '/employee/drive-log');
        const purposeInput = page.locator('input#purpose');
        await expect(purposeInput).toBeVisible({ timeout: 15000 });
        const chip = page.getByRole('group', { name: '자주 쓰는 목적' }).getByRole('button', { name: '가정방문' });
        await expect(chip).toBeVisible({ timeout: 10000 });
        await chip.click();
        await expect(purposeInput).toHaveValue('가정방문');
        await expect(chip).toHaveAttribute('aria-pressed', 'true');

        // 3. 새로 적은 목적은 칸 아래 버튼으로 바로 저장
        await purposeInput.fill('병원 동행');
        await page.getByRole('button', { name: '+ 자주 쓰는 목적에 저장' }).click();
        await expect(
            page.getByRole('group', { name: '자주 쓰는 목적' }).getByRole('button', { name: '병원 동행' }),
        ).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole('button', { name: '+ 자주 쓰는 목적에 저장' })).toHaveCount(0);
        await page.locator('input#purpose').scrollIntoViewIfNeeded();
        await page.screenshot({ path: 'test-results/authed/favorite-purposes-drive-log.png' });

        // 4. 관리 화면에 둘 다 보이고, 지우면 사라진다 (다음 실행을 위해 정리)
        await gotoStable(page, '/employee/purposes');
        await expect(page.getByText('병원 동행', { exact: true })).toBeVisible({ timeout: 10000 });
        for (const text of ['가정방문', '병원 동행']) {
            await page.getByRole('button', { name: `${text} 삭제` }).click();
            await page.getByRole('button', { name: /^(삭제|확인)$/ }).last().click();
            await expect(page.getByText(text, { exact: true })).toHaveCount(0, { timeout: 10000 });
        }
    });
});
