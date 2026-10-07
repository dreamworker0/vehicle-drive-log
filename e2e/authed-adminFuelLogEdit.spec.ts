import { test, expect, type Page } from '@playwright/test';
import { TEST_ADMIN, TEST_EMPLOYEE, seedFuelLog, deleteFuelLogSeed, readFuelLogSeed } from './emulator/seed';

/**
 * 관리자의 주유 기록 정정 E2E (에뮬레이터 전용 — playwright.emulator.config.ts).
 *
 * 단위 테스트는 Firestore를 목으로 대체하므로 **Rules가 실제로 이 쓰기를 통과시키는지**를
 * 증명하지 못한다. 특히 이 경로는 관리자가 **남의 기록**을 고치면서 행위자 스탬프
 * (`lastEditedByUid`)를 함께 심는다 — 화면·SDK·Rules 세 층이 다 맞아야 저장된다.
 * 하나라도 어긋나면 사용자에게는 "수정에 실패했습니다" 토스트로만 보이므로 여기서 잡는다.
 */

declare global {
    interface Window {
        __E2E_AUTH__?: {
            signIn: (email: string, password: string) => Promise<unknown>;
            signOut: () => Promise<void>;
        };
    }
}

const FUEL_LOG_ID = 'e2e-fuel-admin-edit';

async function signIn(page: Page, email: string, password: string) {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__E2E_AUTH__, null, { timeout: 15000 });
    await page.evaluate(
        ([e, p]) => { void window.__E2E_AUTH__!.signIn(e, p); },
        [email, password] as const,
    ).catch(() => { /* 네비게이션으로 인한 컨텍스트 파괴 무시 */ });
}

test.describe('관리자 주유 기록 정정 E2E (에뮬레이터)', () => {
    test.afterAll(async () => {
        await deleteFuelLogSeed(FUEL_LOG_ID);
    });

    test('관리자가 직원의 주유량·금액을 고치면 저장되고 수정자가 남는다', async ({ page }) => {
        page.on('console', (msg) => {
            if (msg.type() === 'error') console.log('[browser error]', msg.text());
        });

        // 직원(e2e-emp) 명의의 기록 — 관리자가 '남의 기록'을 고치는 경로다
        await seedFuelLog(FUEL_LOG_ID, { fuelAmount: 40, fuelCost: 60000 });

        await signIn(page, TEST_ADMIN.email, TEST_ADMIN.password);
        await page.waitForURL(/\/admin/, { timeout: 25000 });
        await page.goto('/admin/logs?tab=fuel');

        // 목록에 시드 기록이 뜰 때까지 기다린다(60,000원)
        await expect(page.getByText('60,000원').first()).toBeVisible({ timeout: 15000 });

        // ✏️ 수정 → 정정 폼이 열린다
        await page.getByRole('button', { name: '기록 수정' }).first().click();
        const amountInput = page.locator('input[placeholder="40.5"]');
        await expect(amountInput).toBeVisible({ timeout: 10000 });
        // 폼은 기존 값으로 채워져 있어야 한다 — 빈 칸이면 정정이 아니라 재입력이다
        await expect(amountInput).toHaveValue('40');

        await amountInput.fill('32.5');
        await page.locator('input[placeholder="65000"]').fill('48000');
        await page.getByRole('button', { name: '수정 완료' }).click();

        // 화면 갱신 — 고친 값이 목록에 보이고 '관리자 수정' 표시가 붙는다.
        // 목록은 모바일·데스크탑 두 벌의 마크업을 함께 그리고 CSS로 한쪽만 보여 주므로
        // (`sm:hidden` / `hidden sm:grid`), 보이는 것만 골라야 한다 — 그냥 first()를 쓰면
        // 데스크탑 뷰포트에서 숨겨진 모바일 쪽을 집는다.
        await expect(page.getByText('48,000원').filter({ visible: true }).first()).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('관리자 수정').filter({ visible: true }).first()).toBeVisible();

        // Firestore에 실제로 저장됐는지 확인 — 화면만 바뀌고 저장이 안 되면 최악이다
        const saved = await readFuelLogSeed(FUEL_LOG_ID);
        expect(saved?.fuelAmount).toBe(32.5);
        expect(saved?.fuelCost).toBe(48000);
        // 행위자 스탬프는 관리자 uid여야 한다(Rules가 타인 명의를 거부하므로 저장 자체가 증거)
        expect(saved?.lastEditedByUid).toBe(TEST_ADMIN.uid);
        // 주유원은 그대로 직원 — 정정이 기록의 주인을 바꾸지 않는다
        expect(saved?.driverUid).toBe(TEST_EMPLOYEE.uid);
    });
});
