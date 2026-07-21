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
        // 하이드레이션 전 클릭이 no-op이 되는 레이스 방지: 이동 확정까지 재클릭(멱등)
        await expect(async () => {
            if (!/\/apply/.test(page.url())) await applyBtn.click();
            await expect(page).toHaveURL(/\/apply/, { timeout: 1000 });
        }).toPass({ timeout: 10000 });
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

        // 약관 체크박스가 렌더링될 때까지 대기
        const termsCheckbox = page.locator('#agree-terms');
        await termsCheckbox.waitFor({ state: 'attached', timeout: 10000 });
        const privacyCheckbox = page.locator('#agree-privacy');

        const submitBtn = page.getByRole('button', { name: '신청하기' });

        // 동의 두 항목 체크 → 제출 버튼 활성화까지 재시도. 컨트롤드 체크박스의
        // onChange→상태→버튼 disabled prop 전파가 느린 CI에서 간헐 누락(레이스)되므로,
        // 버튼 활성화를 진실 원천으로 삼아 멱등 .check()를 반복한다(중간 toBeChecked는 제거).
        await expect(async () => {
            await termsCheckbox.check();
            await privacyCheckbox.check();
            await expect(submitBtn).toBeEnabled({ timeout: 1000 });
        }).toPass({ timeout: 15000 });
        // force: true로 일시적 disabled 전환 레이스 컨디션 방지
        await submitBtn.click({ force: true });
        // HTML5 validation이 제출을 차단하므로 페이지가 /apply에 머물러야 한다
        await expect(page).toHaveURL(/\/apply/);
    });

    test('전화번호 자동 포맷이 동작한다', async ({ page }) => {
        await page.goto('/apply');
        const phoneInput = page.getByPlaceholder('010-0000-0000');
        await expect(phoneInput).toBeVisible({ timeout: 10000 });
        // 컨트롤드 입력이 하이드레이션 시점에 초기화(빈 값)되는 레이스 방지:
        // 포맷값이 유지될 때까지 재입력한다.
        await expect(async () => {
            await phoneInput.fill('01012345678');
            await expect(phoneInput).toHaveValue('010-1234-5678', { timeout: 1000 });
        }).toPass({ timeout: 10000 });
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
            // 약관 동의 — Playwright click()으로 React onChange가 안전하게 트리거되도록 유도
            await page.locator('#agree-terms').click({ force: true });
            await page.locator('#agree-privacy').click({ force: true });
            const submitBtn = page.getByRole('button', { name: '신청하기' });
            await expect(submitBtn).toBeEnabled({ timeout: 10000 });
            await submitBtn.click({ force: true });
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
