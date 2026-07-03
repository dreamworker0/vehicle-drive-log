import { test, expect } from '@playwright/test';

test.describe('오류 복구 및 ErrorBoundary E2E 시나리오', () => {

    // 403 강제 응답 후 에러 피드백(토스트/ErrorBoundary) 검증은 인증 세션이 있어야
    // Firestore 통신 자체가 발생하므로 비인증 스모크로는 성립하지 않는다.
    // 필요 시 authed-* 에뮬레이터 E2E(CI 게이트)로 이관한다. (과거 본문 중간 fixme로
    // 아무것도 검증하지 않으면서 구조만 남아 있던 것을 선언형 fixme로 정직화)
    test.fixme('403 권한 오류 발생 시 에러 피드백(토스트 등)이 표시되는지 검증', async () => {
        // authed 에뮬레이터 E2E로 이관 예정
    });

    test('정의되지 않은 라우트(404 경로) 진입 시 RouteFallback이 적절한 페이지로 리다이렉트하는지 검증', async ({ page }) => {
        // 미인증 상태로 정의되지 않은 라우트 이동
        await page.goto('/undefined-random-route');
        
        // App.tsx 의 RouteFallback 로직에 의해 비로그인 사용자는 '/' 경로로 리다이렉트됨을 확인
        await page.waitForURL((url) => url.pathname === '/', { timeout: 5000 });
        await expect(page.getByRole('heading', { name: /차량 운행일지/ })).toBeVisible({ timeout: 10000 });
    });
});
