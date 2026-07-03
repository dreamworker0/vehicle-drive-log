import { test, expect, type Page } from '@playwright/test';
import { TEST_ADMIN, seedPendingReservation } from './emulator/seed';

/**
 * 예약 승인/반려 여정 E2E (에뮬레이터 전용 — playwright.emulator.config.ts).
 *
 * core-workflows.spec.ts / reservation-approval.spec.ts의 승인·반려 fixme를 이관·구현한 것.
 * 승인/반려는 `updateReservationStatus`/`rejectReservation`(직접 Firestore 쓰기·트랜잭션)이라
 * functions 에뮬레이터 없이도 동작한다. 반면 예약 "생성"은 `createReservationSafe` 콜러블
 * 경유라 이 환경에서 UI로 재현할 수 없어, pending 예약은 admin SDK로 직접 시드한다
 * (생성 로직은 functions/src/__tests__/createReservationSafe.test.ts가 커버).
 *
 * 관리자 승인 대기 목록은 /admin/reservations(ReservationCalendar isAdmin → PendingReservationList).
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

/** 승인 대기 목록에서 특정 목적지(destination)를 가진 예약 행을 반환. */
function reservationRow(page: Page, destination: string) {
    return page.locator('div.group').filter({ hasText: destination });
}

test.describe('예약 승인/반려 여정 E2E (에뮬레이터)', () => {
    test('관리자가 승인 대기 예약을 승인하면 승인 토스트가 뜨고 목록에서 사라진다', async ({ page }) => {
        page.on('console', (msg) => {
            if (msg.type() === 'error') console.log('[browser error]', msg.text());
        });

        const DESTINATION = 'E2E 승인 대상 목적지';
        // pending 예약 시드 (admin SDK, 네비게이션 전에 완료)
        await seedPendingReservation('e2e-res-approve', { destination: DESTINATION });

        await signIn(page, TEST_ADMIN.email, TEST_ADMIN.password);
        await page.waitForURL(/\/admin/, { timeout: 25000 });
        await page.goto('/admin/reservations');

        const row = reservationRow(page, DESTINATION);
        const approveBtn = row.getByRole('button', { name: '승인' });
        await expect(approveBtn).toBeVisible({ timeout: 15000 });
        await approveBtn.click();

        // 승인 성공 계약: 토스트 + 목록에서 제거(pending → reserved)
        await expect(page.locator('text=예약이 승인되었습니다').first()).toBeVisible({ timeout: 15000 });
        await expect(reservationRow(page, DESTINATION)).toHaveCount(0, { timeout: 10000 });
    });

    test('관리자가 승인 대기 예약을 반려하면 사유 입력 모달을 거쳐 목록에서 사라진다', async ({ page }) => {
        page.on('console', (msg) => {
            if (msg.type() === 'error') console.log('[browser error]', msg.text());
        });

        const DESTINATION = 'E2E 반려 대상 목적지';
        await seedPendingReservation('e2e-res-reject', { destination: DESTINATION });

        await signIn(page, TEST_ADMIN.email, TEST_ADMIN.password);
        await page.waitForURL(/\/admin/, { timeout: 25000 });
        await page.goto('/admin/reservations');

        const row = reservationRow(page, DESTINATION);
        const rejectBtn = row.getByRole('button', { name: '반려' });
        await expect(rejectBtn).toBeVisible({ timeout: 15000 });
        await rejectBtn.click();

        // 반려 사유 입력 모달(ConfirmModal type=input) — 사유는 선택 사항이나 입력해 경로를 검증
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 10000 });
        await dialog.getByPlaceholder('예: 부적절한 사용 목적').fill('E2E 반려 사유');
        await dialog.getByRole('button', { name: '반려' }).click();

        // 반려 성공 계약: 토스트 + 목록에서 제거(pending → rejected)
        await expect(page.locator('text=예약이 반려되었습니다').first()).toBeVisible({ timeout: 15000 });
        await expect(reservationRow(page, DESTINATION)).toHaveCount(0, { timeout: 10000 });
    });
});
