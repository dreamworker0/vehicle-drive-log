import { test, expect, type Page } from '@playwright/test';
import { TEST_EMPLOYEE } from './emulator/seed';

/**
 * 운행일지 작성 여정 E2E (에뮬레이터 전용 — playwright.emulator.config.ts).
 *
 * core-workflows.spec.ts의 `test.fixme('운행기록일지 작성 및 첨부파일 검증')`를 이관·구현한 것.
 * 온라인 정상 경로(작성 → 저장 → 서버 반영 → 폼 리셋)를 실제 로그인 세션으로 검증한다.
 * (오프라인 큐 경로는 authed-offlineSync.spec.ts가 별도로 커버.)
 *
 * 첨부(계기판 사진 → OCR)는 `test:e2e:emulator`가 auth/firestore 에뮬레이터만 띄우고
 * functions 에뮬레이터는 없어 OCR 콜러블을 실행할 수 없으므로, 여기서는 첨부 컨트롤이
 * 존재한다는 것과 **첨부 없이도 저장된다(첨부는 선택)**는 계약만 검증한다.
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

test.describe('운행일지 작성 여정 E2E (에뮬레이터)', () => {
    test('직원이 온라인에서 운행일지를 작성·저장하면 서버에 반영되고 폼이 리셋된다', async ({ page }) => {
        // CI 디버깅용: 브라우저 콘솔 에러를 테스트 출력으로 전달 +
        // 시드 계약 위반(`[Zod]`)을 수집해 테스트 종료 시 0건을 단언한다.
        // 이 여정은 /employee/drive-log에서 차량(vehicleSchema)을 실제 파싱하므로,
        // 시드 필수 필드 누락이 여기서 표면화된다.
        const zodErrors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() !== 'error') return;
            console.log('[browser error]', msg.text());
            if (msg.text().includes('[Zod]')) zodErrors.push(msg.text());
        });

        const DESTINATION = 'E2E 온라인 작성 목적지';

        // 1. 직원 로그인 후 운행일지 작성 페이지로 이동
        await signIn(page, TEST_EMPLOYEE.email, TEST_EMPLOYEE.password);
        await page.waitForURL(/\/employee/, { timeout: 25000 });
        // networkidle 대기는 쓰지 않는다 — Firestore 리스너가 연결을 유지해 idle에 도달하지 못함.
        // 로그인 직후 전체 리로드로 이동하면 인증 재초기화 중 가드가 잠시 리다이렉트해
        // goto가 ERR_ABORTED로 중단될 수 있다(특히 콜드 컴파일이 겹치는 첫 실행). 최종적으로
        // drive-log에 안착할 때까지 재시도한다.
        await expect(async () => {
            await page.goto('/employee/drive-log', { waitUntil: 'commit' }).catch(() => { /* 리다이렉트 중단 무시 */ });
            await expect(page).toHaveURL(/\/employee\/drive-log/, { timeout: 3000 });
        }).toPass({ timeout: 25000 });

        // 2. 차량 선택 (VehicleSelector 그리드)
        const vehicleBtn = page.locator('.grid.grid-cols-3 button').first();
        await expect(vehicleBtn).toBeVisible({ timeout: 15000 });
        await vehicleBtn.click();

        // 3. 첨부 컨트롤(계기판 사진) 존재 확인 — OCR은 트리거하지 않는다(functions 에뮬레이터 없음).
        //    첨부는 선택 사항이며, 이 테스트는 미첨부 상태로 저장이 성공함을 확인한다.
        await expect(page.getByRole('button', { name: /계기판 촬영/ })).toBeVisible();

        // 4. 폼 작성
        await page.fill('input#purpose', 'E2E 온라인 목적');
        await page.fill('input#destination', DESTINATION);

        // 도착 km — 출발 km(차량 currentKm 자동 채움) + 1000km.
        // 큰 간격을 두어 동시 실행 스펙(오프라인 +42)과의 currentKm 경합에도 endKm > startKm이 유지된다.
        // (임의의 큰 값은 "한 번의 운행 10,000km 초과 금지" 검증에 걸리므로 1000으로 제한)
        const startKmValue = await page.locator('input[type="number"]').first().inputValue();
        await page.locator('input[placeholder="12400"]').fill(String(Number(startKmValue || '0') + 1000));

        // 5. 저장
        await page.getByRole('button', { name: /운행일지 저장/ }).click();

        // 6. 온라인 신규 저장 성공 계약 1 — 내비게이션 없이 폼이 리셋된다
        //    (useDriveLogSubmit: 신규 저장은 shouldResetForm 분기 → 폼 초기화)
        await expect(page.locator('input#destination')).toHaveValue('', { timeout: 15000 });

        // 7. 성공 계약 2 — 서버(에뮬레이터)에 실제 반영된다. 내 기록에서 조회로 검증.
        await page.goto('/employee/my-records');
        await expect(page.locator(`text=${DESTINATION}`).first()).toBeVisible({ timeout: 20000 });

        // 시드 계약 검증 — 여정 전체에서 Zod 파싱 오류가 없어야 한다.
        expect(zodErrors).toEqual([]);
    });
});
