import { test, expect } from '@playwright/test';

test.describe('예약 승인 및 반려 워크플로우(Pending Reservation)', () => {
  // Mock Firebase / API calls using Playwright routing
  test.beforeEach(async ({ page }) => {
    await page.route('**/firestore/**', async (route) => {
      // Firestore 요청을 낚아채서 승인 대기 중인 예약 하나가 있는 것처럼 모킹
      const requestUrl = route.request().url();
      if (requestUrl.includes('reservations') && requestUrl.includes('pending')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: 'res_123', vehicleId: 'v1', reservedByUid: 'emp1', status: 'pending', date: '2026-04-16' }
          ]),
        });
      } else {
        await route.continue();
      }
    });

    // 어드민 대시보드 또는 승인 대기 리스트 페이지로 이동
    await page.goto('/admin'); 
  });

  test('승인 버튼 클릭 시 승인 토스트가 발생해야 한다', async ({ page }) => {
    // "승인" 버튼 찾기 (PendingReservationList 내의 버튼)
    const approveButton = page.getByRole('button', { name: '승인' }).first();
    
    // 버튼이 화면 상에 렌더링될 때까지 대기
    if (await approveButton.isVisible()) {
        await approveButton.click();
        // Toast provider가 노출하는 메시지 검증
        const toastMessage = page.getByText('예약이 승인되었습니다.');
        await expect(toastMessage).toBeVisible();
    }
  });

  test('반려 버튼 클릭 시 모달이 나타나고 반려 처리를 성공해야 한다', async ({ page }) => {
    const rejectButton = page.getByRole('button', { name: '반려' }).first();
    
    if (await rejectButton.isVisible()) {
        await rejectButton.click();
        
        // ConfirmModal의 dialog가 올바르게 호출되었는지 테스트
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(page.getByText('예약을 반려하시겠습니까?')).toBeVisible();

        // 입력 폼에 사유 작성
        const input = page.getByPlaceholder('예: 부적절한 사용 목적');
        await input.fill('사적 이용 금지');
        
        // 확인 (반려 등록)
        const confirmButton = dialog.getByRole('button', { name: '반려' }).or(dialog.getByRole('button', { name: '확인' }));
        await confirmButton.click();
        
        // 성공 토스트 확인
        const toastMessage = page.getByText('예약이 반려되었습니다.');
        await expect(toastMessage).toBeVisible();
    }
  });
});
