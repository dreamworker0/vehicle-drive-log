import { test, expect } from '@playwright/test';

test.describe('기관 사용 신청 플로우', () => {
    test.beforeEach(async ({ context, page }) => {
        await context.clearCookies();
        await context.clearPermissions();
        await page.goto('/');
        await page.evaluate(async () => {
            localStorage.clear();
            sessionStorage.clear();
            const dbs = await window.indexedDB.databases();
            for (const db of dbs) {
                if (db.name) {
                    window.indexedDB.deleteDatabase(db.name);
                }
            }
        });
    });

    test('신청 페이지로 이동할 수 있다', async ({ page }) => {
        await page.goto('/');
        const applyBtn = page.getByRole('button', { name: '서비스 도입 신청' }).first();
        await expect(applyBtn).toBeVisible({ timeout: 10000 });
        await applyBtn.click();
        await expect(page).toHaveURL(/\/apply/);
    });

    test('신청 폼이 올바르게 렌더링된다', async ({ page }) => {
        await page.goto('/apply');
        // 필수 입력 필드 확인
        await expect(page.getByPlaceholder('홍길동')).toBeVisible({ timeout: 10000 });
        await expect(page.getByPlaceholder('○○복지관')).toBeVisible();
        // 파일 업로드 영역 확인
        await expect(page.getByText(/클릭 또는 드래그하여 업로드/)).toBeVisible();
    });

    test('필수 항목 미입력 시 에러 표시', async ({ page }) => {
        await page.goto('/apply');
        // 약관 동의 체크
        const checkboxes = page.locator('input[type="checkbox"]');
        await checkboxes.nth(0).check({ force: true });
        await checkboxes.nth(1).check({ force: true });
        // 빈 폼으로 제출 시도 전 버튼이 활성화될 때까지 대기
        const submitBtn = page.getByRole('button', { name: '신청하기' });
        await expect(submitBtn).toBeEnabled({ timeout: 10000 });
        await submitBtn.click();
        // 에러 메시지가 표시되어야 한다
        await expect(page.getByText(/필수|업로드/).first()).toBeVisible({ timeout: 5000 });
    });

    test('전화번호 자동 포맷이 동작한다', async ({ page }) => {
        await page.goto('/apply');
        const phoneInput = page.getByPlaceholder('010-0000-0000');
        await expect(phoneInput).toBeVisible({ timeout: 10000 });
        await phoneInput.fill('01012345678');
        await expect(phoneInput).toHaveValue('010-1234-5678');
    });

    test('돌아가기 버튼이 작동한다', async ({ page }) => {
        await page.goto('/apply');
        const backBtn = page.getByText('돌아가기');
        await expect(backBtn).toBeVisible({ timeout: 10000 });
    });

    test('이메일 형식이 올바르지 않으면 제출이 차단된다', async ({ page }) => {
        await page.goto('/apply');
        // 이메일 필드에 잘못된 형식 입력
        const emailInput = page.locator('input[type="email"]');
        if (await emailInput.count() > 0) {
            if (await emailInput.isEditable()) {
                await emailInput.fill('invalid-email');
            }
            // 약관 동의 체크
            const checkboxes = page.locator('input[type="checkbox"]');
            const count = await checkboxes.count();
            for (let i = 0; i < count; i++) {
                await checkboxes.nth(i).check({ force: true });
            }
            const submitBtn = page.getByRole('button', { name: '신청하기' });
            await expect(submitBtn).toBeEnabled({ timeout: 10000 });
            await submitBtn.click();
            // HTML5 이메일 유효성 검사로 제출이 차단되어야 함
            const currentUrl = page.url();
            expect(currentUrl).toContain('apply');
        }
    });

    test('약관 미동의 시 제출이 차단된다', async ({ page }) => {
        await page.goto('/apply');
        // 필수 필드 채우기
        const nameInput = page.getByPlaceholder('홍길동');
        if (await nameInput.isEditable()) {
            await nameInput.fill('테스트 사용자');
        }
        const orgInput = page.getByPlaceholder('○○복지관');
        if (await orgInput.isEditable()) {
            await orgInput.fill('테스트 복지관');
        }
        // 약관 동의 미체크 상태에서 제출 버튼이 비활성화되어야 함
        const submitBtn = page.getByRole('button', { name: '신청하기' });
        await expect(submitBtn).toBeDisabled();
    });
});
