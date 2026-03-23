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
        await expect(page.getByRole('button', { name: '기관 신청하기' })).toBeVisible();
        await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();
        // 무료 안내 텍스트
        await expect(page.getByText(/완전 무료/)).toBeVisible();
    });

    test('3단계 시작 섹션이 표시된다', async ({ page }) => {
        const heading = page.getByText('3단계로 시작하세요');
        await expect(heading).toBeAttached({ timeout: 10000 });
        await heading.scrollIntoViewIfNeeded();
        await expect(heading).toBeVisible({ timeout: 10000 });
        const steps = ['기관 신청', '직원 초대', '바로 사용'];
        for (const step of steps) {
            const el = page.getByRole('heading', { name: step });
            await expect(el).toBeAttached({ timeout: 5000 });
            await el.scrollIntoViewIfNeeded();
            await expect(el).toBeVisible();
        }
    });

    test('주요 기능 카드 6개가 표시된다', async ({ page }) => {
        const features = ['AI 계기판 인식', '운행일지 자동화', '차량 예약 시스템', '길안내 앱 연동', '통계·분석·출력', '정비 기록 관리'];
        for (const title of features) {
            const el = page.getByRole('heading', { name: title });
            await el.scrollIntoViewIfNeeded();
            await expect(el).toBeVisible({ timeout: 10000 });
        }
    });

    test('부가 기능 칩이 표시된다', async ({ page }) => {
        const chips = ['구글 캘린더 연동', '오프라인 지원', '푸시 알림', '기관별 데이터 격리', '다크 모드', '매일 자동 백업'];
        for (const label of chips) {
            await expect(page.getByText(label)).toBeVisible({ timeout: 10000 });
        }
    });

    test('대상 안내 섹션이 표시된다', async ({ page }) => {
        const heading = page.getByText('누가 사용할 수 있나요?');
        await heading.scrollIntoViewIfNeeded();
        await expect(heading).toBeVisible({ timeout: 10000 });
        await expect(page.getByText(/고유번호증 또는 사업자등록증/)).toBeVisible();
        await expect(page.getByText(/영리 기업/)).toBeVisible();
    });

    test('하단 CTA 섹션이 표시된다', async ({ page }) => {
        await expect(page.getByText('지금 바로 시작하세요')).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole('button', { name: '기관 사용 신청하기' })).toBeVisible();
    });

    test('푸터에 약관/개인정보 링크가 있다', async ({ page }) => {
        await expect(page.getByRole('link', { name: '이용약관' })).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole('link', { name: '개인정보 처리방침' })).toBeVisible();
        await expect(page.getByText(/© 2026/)).toBeVisible();
    });

    test('기관 신청하기 CTA 클릭 시 신청 페이지로 이동한다', async ({ page }) => {
        const ctaBtn = page.getByRole('button', { name: '기관 신청하기' }).first();
        await ctaBtn.click();
        await expect(page).toHaveURL(/\/apply/);
    });

    test('로그인 버튼 클릭 시 로그인 페이지로 이동한다', async ({ page }) => {
        const loginBtn = page.getByRole('button', { name: '로그인' });
        await loginBtn.click();
        await expect(page).toHaveURL(/login/);
    });
});
