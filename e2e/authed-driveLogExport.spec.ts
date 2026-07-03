import { test, expect, type Page } from '@playwright/test';
import { TEST_ADMIN, seedDriveLog } from './emulator/seed';

/**
 * 관리자 데이터 내보내기 여정 E2E (에뮬레이터 전용 — playwright.emulator.config.ts).
 *
 * core-workflows.spec.ts의 '관리자 데이터 내보내기 (엑셀 및 PDF) 검증' fixme를 이관·구현한 것.
 * 내보내기 화면: /admin/logs (LogManager, 기본 'drive' 탭 → DriveLogList → DriveLogExportBar).
 *
 * 엑셀은 클라이언트에서 파일을 생성·다운로드하므로 Playwright의 download 이벤트로 검증한다.
 * PDF는 `downloadDriveLogsPdf`가 `window.open` + `window.print()`(브라우저 인쇄 대화상자)를
 * 사용해 헤드리스에서 자동화·검증할 수 없어 이 여정에서는 다루지 않는다
 * (직렬화 로직은 src/__tests__/lib/excelExport.test.ts가 커버).
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

test.describe('운행일지 내보내기 여정 E2E (에뮬레이터)', () => {
    test('관리자가 기간을 지정해 엑셀로 내보내면 xlsx 파일이 다운로드된다', async ({ page }) => {
        page.on('console', (msg) => {
            if (msg.type() === 'error') console.log('[browser error]', msg.text());
        });

        // 내보낼 운행일지 1건 시드 (기간 2026-07-01~07-04 안의 07-02)
        await seedDriveLog('e2e-log-export', { date: '2026-07-02' });

        await signIn(page, TEST_ADMIN.email, TEST_ADMIN.password);
        await page.waitForURL(/\/admin/, { timeout: 25000 });
        await page.goto('/admin/logs'); // 기본 'drive' 탭 = 운행일지 목록

        // 엑셀 버튼은 목록에 1건 이상 있어야 활성화(filteredCount > 0)
        const excelBtn = page.getByRole('button', { name: '엑셀' });
        await expect(excelBtn).toBeEnabled({ timeout: 15000 });

        // 내보내기는 기간(시작·종료일) 지정이 필수 (validateExportDates)
        const dateInputs = page.locator('input[type="date"]');
        await dateInputs.nth(0).fill('2026-07-01');
        await dateInputs.nth(1).fill('2026-07-04');
        // 기간 필터 적용 후에도 시드 로그(07-02)가 범위 안이라 버튼은 활성 유지
        await expect(excelBtn).toBeEnabled();

        // 엑셀 다운로드 계약: 클릭 시 .xlsx 파일 다운로드 발생
        const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
        await excelBtn.click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
        expect(download.suggestedFilename()).toContain('운행일지');
    });
});
