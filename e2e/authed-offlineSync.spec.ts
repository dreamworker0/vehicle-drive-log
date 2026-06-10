import { test, expect, type Page } from '@playwright/test';
import { TEST_EMPLOYEE } from './emulator/seed';

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

test.describe('Offline-First 쓰기 큐 및 백그라운드 동기화 E2E', () => {
    test('오프라인 상태에서 운행일지 작성 후 온라인 전환 시 동기화된다', async ({ page, context }) => {
        // 1. 온라인 상태에서 앱에 로그인
        await signIn(page, TEST_EMPLOYEE.email, TEST_EMPLOYEE.password);
        await page.waitForURL(/\/employee/, { timeout: 25000 });

        // 운행일지 작성 페이지로 이동
        await page.goto('/drive-logs/new');
        await page.waitForLoadState('networkidle');

        // 차량 목록이 뜰 때까지 대기
        const vehicleBtn = page.locator('.grid.grid-cols-3 button').first();
        await expect(vehicleBtn).toBeVisible({ timeout: 10000 });

        // 2. 오프라인 모드 전환
        await context.setOffline(true);
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
            window.dispatchEvent(new Event('offline'));
        });

        // 3. 폼 작성 및 저장 버튼 클릭
        await vehicleBtn.click();
        await page.fill('input#purpose', '오프라인 테스트 목적');
        await page.fill('input#destination', 'E2E 오프라인 목적지');
        
        // 도착 km (임의의 큰 값)
        await page.locator('input[placeholder="12400"]').fill('999999');

        // 저장 버튼 클릭
        await page.getByRole('button', { name: /운행일지 저장/ }).click();

        // 4. 에러 발생 없이(리다이렉트되거나 성공 메시지 표시) 정상 처리되는지 확인
        // useDriveLogForm 훅은 성공 시 router.push('/employee') 또는 '/drive-logs'로 이동하거나 성공 메시지를 띄움
        // 통상적으로 성공 시 /employee 혹은 원래 페이지로 리다이렉트됨. 
        await page.waitForURL(/\/employee/, { timeout: 10000 });
        await expect(page).toHaveURL(/\/employee/);

        // 로컬 리스트에 반영되었는지(또는 큐잉 확인)
        // 화면 어딘가에 대기중 아이콘이나, 제출한 텍스트('E2E 오프라인 목적지')가 리스트에 보일 것을 기대함
        await expect(page.locator('text=E2E 오프라인 목적지').first()).toBeVisible({ timeout: 5000 });
        // 낙관적 UI 또는 IndexedDB 큐 반영을 확인. 만약 리스트업이 없다면 에러 없이 넘어온 것만으로도 오프라인 처리 통과로 봄.
        
        // 5. 브라우저를 다시 온라인으로 전환
        await context.setOffline(false);
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
            window.dispatchEvent(new Event('online'));
        });

        // 6. 백그라운드 동기화 후 서버에 반영되어 정상 상태가 되는지 대기
        // 네트워크 요청이 재개되고 큐가 비워질 시간을 줌
        await page.waitForTimeout(3000);

        // IndexedDB의 action-queue가 비워졌는지 확인 (선택적)
        await expect.poll(async () => {
            return await page.evaluate(async () => {
                return new Promise<number>((resolve) => {
                    const req = window.indexedDB.open('veh-log-offline-sync', 1);
                    req.onsuccess = (e: Event) => {
                        const target = e.target as IDBOpenDBRequest;
                        const db = target.result;
                        if (!db.objectStoreNames.contains('action-queue')) {
                            db.close();
                            return resolve(0);
                        }
                        const tx = db.transaction('action-queue', 'readonly');
                        const store = tx.objectStore('action-queue');
                        const countReq = store.count();
                        countReq.onsuccess = () => { db.close(); resolve(countReq.result); };
                        countReq.onerror = () => { db.close(); resolve(100); };
                    };
                    req.onerror = () => resolve(100);
                });
            });
        }, {
            message: '온라인 전환 후 오프라인 큐가 비워져야 합니다',
            timeout: 15000,
        }).toBe(0);
    });
});
