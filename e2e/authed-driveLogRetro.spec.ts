import { test, expect, type Page } from '@playwright/test';
import { TEST_EMPLOYEE, seedDriveLog } from './emulator/seed';

/**
 * 누락 운행 소급 입력 여정 E2E (에뮬레이터 전용 — playwright.emulator.config.ts).
 *
 * 검증 대상: 예약 없이 "내 기록 → 누락 운행 입력"으로 지난 운행을 직접 소급 기록하는 신규 경로.
 * - 진입점 버튼 → drive-log 폼이 "누락 운행 소급 입력" 모드(신규+날짜 섹션 노출)로 열린다.
 * - 과거 일자를 고르면 그 날짜 직전 기록의 도착 km가 출발 km로 자동 입력된다(resolveStartKm).
 * - 직후 기록이 있으면 "직후 운전 정보" 배너가 뜬다(신규 모드 nextDriveLog 조회 — Effect 3 변경분).
 * - 저장 시 소급(isRetroactive)으로 기록되어 내 기록에 "소급" 뱃지와 함께 나타난다.
 *
 * km 연쇄 보정(뒤 기록 재정합)은 Cloud Functions 트리거(onDriveLogCreated)가 담당하며,
 * 이 E2E는 auth/firestore 에뮬레이터만 띄우므로(트리거 없음) 여기서는 다루지 않는다.
 * (재정합 로직 자체는 functions 단위 테스트가 별도로 커버한다.)
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

/** YYYY-MM-DD (로컬) */
function fmt(dt: Date): string {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
/** 오늘 기준 n일 전 날짜 */
function daysAgo(n: number): Date {
    const t = new Date();
    t.setDate(t.getDate() - n);
    return t;
}

test.describe('누락 운행 소급 입력 여정 E2E (에뮬레이터)', () => {
    test('직원이 예약 없이 과거 누락 운행을 소급 입력하면 소급 기록으로 저장된다', async ({ page }) => {
        const zodErrors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() !== 'error') return;
            console.log('[browser error]', msg.text());
            if (msg.text().includes('[Zod]')) zodErrors.push(msg.text());
        });

        // 소급 삽입 대상 날짜(today-7)를 사이에 두고 직전(today-10)/직후(today-3) 기록을 시드.
        // 날짜 창을 좁게 두어 다른 스펙이 만드는 "오늘" 기록과 간섭하지 않게 한다.
        // 출발 km는 직전 도착 km(60123)로 자동 채워지고, 빈틈(60123~60200)을 메우도록 도착 60200 입력.
        const prev = daysAgo(10);
        const retroDate = daysAgo(7);
        const next = daysAgo(3);
        await seedDriveLog('e2e-retro-prev', {
            date: fmt(prev),
            timestamp: new Date(prev.getFullYear(), prev.getMonth(), prev.getDate(), 9, 0),
            startKm: 60000, endKm: 60123, distance: 123, destination: '(retro-prev)',
        });
        await seedDriveLog('e2e-retro-next', {
            date: fmt(next),
            timestamp: new Date(next.getFullYear(), next.getMonth(), next.getDate(), 9, 0),
            startKm: 60200, endKm: 60250, distance: 50, destination: '(retro-next)',
        });

        const DESTINATION = 'E2E 누락 소급 목적지';

        // 1. 직원 로그인 → 내 기록으로 이동
        await signIn(page, TEST_EMPLOYEE.email, TEST_EMPLOYEE.password);
        await page.waitForURL(/\/employee/, { timeout: 25000 });
        await expect(async () => {
            await page.goto('/employee/my-records', { waitUntil: 'commit' }).catch(() => { /* 리다이렉트 중단 무시 */ });
            await expect(page).toHaveURL(/\/employee\/my-records/, { timeout: 3000 });
        }).toPass({ timeout: 25000 });

        // 2. "누락 운행 입력" 진입점 클릭 → 소급 입력 폼(신규 모드 + 날짜 섹션)
        //    반드시 버튼 클릭으로 이동해야 react-router state(retroactive)가 전달된다.
        const retroBtn = page.getByRole('button', { name: /누락 운행 입력/ });
        await expect(retroBtn).toBeVisible({ timeout: 20000 });
        await retroBtn.click();

        await expect(page).toHaveURL(/\/employee\/drive-log/, { timeout: 15000 });
        await expect(page.getByRole('heading', { name: '누락 운행 소급 입력' })).toBeVisible({ timeout: 15000 });

        // 3. 신규 모드인데도 운행 일자 입력이 노출된다(핵심 신규 동작)
        const dateInput = page.locator('input#driveDate');
        await expect(dateInput).toBeVisible();

        // 4. 차량 선택 → 과거 일자 지정
        const vehicleBtn = page.locator('.grid.grid-cols-3 button').first();
        await expect(vehicleBtn).toBeVisible({ timeout: 15000 });
        await vehicleBtn.click();
        await dateInput.fill(fmt(retroDate));

        // 5. 출발 km 자동 채움 = 직전 기록 도착 km(60123)
        const startKmInput = page.locator('input[type="number"]').first();
        await expect(startKmInput).toHaveValue('60123', { timeout: 15000 });

        // 6. 직후 운전 정보 배너 노출(신규 모드 nextDriveLog 조회 검증)
        //    안내 문구에도 같은 단어가 있어 배너 헤더(이모지 포함)로 특정한다.
        await expect(page.getByText('ℹ️ 직후 운전 정보')).toBeVisible({ timeout: 15000 });

        // 7. 폼 작성(빈틈 메우기: 도착 km = 직후 출발 km) 후 저장
        await page.fill('input#destination', DESTINATION);
        await page.locator('input[type="number"]').nth(1).fill('60200');
        await page.getByRole('button', { name: /운행일지 저장/ }).click();

        // 8. 신규 저장 성공 계약 — 내비게이션 없이 폼이 리셋된다
        await expect(page.locator('input#destination')).toHaveValue('', { timeout: 15000 });

        // 9. 내 기록에 소급 기록으로 반영 — 목적지 + "소급" 뱃지 확인
        await page.goto('/employee/my-records');
        const recordRow = page.locator(`text=${DESTINATION}`).first();
        await expect(recordRow).toBeVisible({ timeout: 20000 });
        await expect(page.getByText('소급', { exact: true }).first()).toBeVisible({ timeout: 15000 });

        expect(zodErrors).toEqual([]);
    });
});
