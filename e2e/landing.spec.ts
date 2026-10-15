import { test, expect } from '@playwright/test';

test.describe('랜딩 페이지', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('히어로 영역이 정상 렌더링된다', async ({ page }) => {
        // 메인 타이틀
        await expect(page.getByRole('heading', { name: /차량 운행일지/ })).toBeVisible({ timeout: 10000 });
        // 서브 타이틀
        await expect(page.getByText('사회복지기관·비영리단체 전용')).toBeVisible();
        // CTA 버튼 2개
        await expect(page.getByRole('button', { name: '서비스 도입 신청' }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: '직원 로그인' })).toBeVisible();
        // 무료 안내 텍스트
        await expect(page.getByText(/완전 무료/)).toBeVisible();
    });

    test('3단계 시작 섹션이 표시된다', async ({ page }) => {
        const heading = page.getByText('단 3단계면 시작할 수 있어요!');
        await expect(heading).toBeVisible({ timeout: 10000 });
        const steps = ['기관 신청', '직원 초대', '바로 사용'];
        for (const step of steps) {
            await expect(page.getByRole('heading', { name: step })).toBeVisible({ timeout: 10000 });
        }
    });

    test('주요 기능 카드 6개가 표시된다', async ({ page }) => {
        const features = ['AI 계기판 인식', '운행일지 자동화', '차량 예약 시스템', '길안내 앱 연동', '통계·분석·출력', '정비 기록 관리'];
        for (const title of features) {
            await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 10000 });
        }
    });

    test('부가 기능 칩이 표시된다', async ({ page }) => {
        const chips = ['구글 캘린더 연동', '오프라인 지원', '푸시 알림', '기관별 데이터 격리', '다크 모드', '매일 자동 백업'];
        for (const label of chips) {
            await expect(page.getByText(label)).toBeVisible({ timeout: 10000 });
        }
    });

    test('대상 안내 섹션이 표시된다', async ({ page }) => {
        const heading = page.getByText('어떤 곳에서 쓸 수 있나요?');
        await expect(heading).toBeVisible({ timeout: 10000 });
        await expect(page.getByText(/고유번호증 또는 사업자등록증/)).toBeVisible();
        await expect(page.getByText(/영리 기업/)).toBeVisible();
    });

    test('하단 CTA 섹션이 표시된다', async ({ page }) => {
        await expect(page.getByText('지금 바로 든든한 차량 관리를 시작해볼까요?')).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole('button', { name: '서비스 도입 신청' }).last()).toBeVisible();
    });

    test('푸터에 약관/개인정보 링크가 있다', async ({ page }) => {
        await expect(page.getByRole('link', { name: '이용약관' })).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole('link', { name: '개인정보 처리방침' })).toBeVisible();
        await expect(page.getByText(/© 2026/)).toBeVisible();
    });

    test('서비스 도입 신청 CTA 클릭 시 신청 페이지로 이동한다', async ({ page }) => {
        const ctaBtn = page.getByRole('button', { name: '서비스 도입 신청' }).first();
        // 하이드레이션 전 클릭이 no-op이 되는 레이스 방지: 이동 확정까지 재클릭(멱등)
        await expect(async () => {
            if (!/\/apply/.test(page.url())) await ctaBtn.click();
            await expect(page).toHaveURL(/\/apply/, { timeout: 1000 });
        }).toPass({ timeout: 10000 });
    });

    test('직원 로그인 버튼 클릭 시 로그인 페이지로 이동한다', async ({ page }) => {
        const loginBtn = page.getByRole('button', { name: '직원 로그인' });
        await expect(async () => {
            if (!/login/.test(page.url())) await loginBtn.click();
            await expect(page).toHaveURL(/login/, { timeout: 1000 });
        }).toPass({ timeout: 10000 });
    });
});

// 회귀 방지(2026-10-14): 처음 로그인하는 직원은 경량 화면으로 시작하는데, 코드 보관은 전체 앱에만
// 있었다. 랜딩에서 [직원 로그인]으로 넘어가는 순간 ?code=가 떨어져 초대 코드 화면이 빈 칸으로 떴다.
test.describe('초대 링크', () => {
    test('비로그인으로 초대 링크를 열면 코드를 보관하고, 로그인 화면으로 넘어가도 남는다', async ({ page }) => {
        await page.goto('/?code=abc123');
        await expect(page.getByRole('button', { name: '직원 로그인' })).toBeVisible({ timeout: 10000 });

        // 부팅 첫 지점이 보관하고 주소창에서 지운다(공유·북마크로 옮겨 가지 않게)
        //
        // 읽는 도중 페이지가 한 번 더 이동할 수 있다 — 첫 방문은 서비스워커가 자리 잡는 시점과 겹쳐
        // mobile-safari에서 `Execution context was destroyed`로 3회 연속 실패했다(2026-10-16 CI #1319).
        // 코드는 이미 localStorage에 있으므로 앱 문제가 아니라 읽는 쪽 경쟁이다. 실패한 읽기는 다시 한다.
        const readPending = () => page.evaluate(() => localStorage.getItem('pendingInviteCode')).catch(() => null);
        await expect.poll(readPending).toBe('ABC123');
        expect(new URL(page.url()).searchParams.get('code')).toBeNull();

        const loginBtn = page.getByRole('button', { name: '직원 로그인' });
        await expect(async () => {
            if (!/login/.test(page.url())) await loginBtn.click();
            await expect(page).toHaveURL(/login/, { timeout: 1000 });
        }).toPass({ timeout: 10000 });
        await expect.poll(readPending).toBe('ABC123');
    });
});
