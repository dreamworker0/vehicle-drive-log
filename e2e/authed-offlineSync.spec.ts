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

/** 오프라인 쓰기 큐(sync-db/sync-store)의 현재 항목 수. 스토어 미존재 시 -1. */
async function queueCount(page: Page): Promise<number> {
    return page.evaluate(async () => {
        return new Promise<number>((resolve) => {
            const req = window.indexedDB.open('sync-db', 1);
            req.onsuccess = (e: Event) => {
                const db = (e.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains('sync-store')) {
                    db.close();
                    return resolve(-1);
                }
                const tx = db.transaction('sync-store', 'readonly');
                const countReq = tx.objectStore('sync-store').count();
                countReq.onsuccess = () => { db.close(); resolve(countReq.result); };
                countReq.onerror = () => { db.close(); resolve(-2); };
            };
            req.onerror = () => resolve(-3);
        });
    });
}

test.describe('Offline-First 쓰기 큐 및 백그라운드 동기화 E2E', () => {
    test('오프라인 상태에서 운행일지 작성 후 온라인 전환 시 동기화된다', async ({ page, context }) => {
        // CI 디버깅용: 브라우저 콘솔 에러를 테스트 출력으로 전달
        page.on('console', (msg) => {
            if (msg.type() === 'error') console.log('[browser error]', msg.text());
        });

        // 1. 온라인 상태에서 앱에 로그인
        await signIn(page, TEST_EMPLOYEE.email, TEST_EMPLOYEE.password);
        await page.waitForURL(/\/employee/, { timeout: 25000 });

        // 운행일지 작성 페이지로 이동 (EmployeeLayout의 "drive-log" 라우트)
        // networkidle 대기는 쓰지 않는다 — Firestore 리스너가 연결을 유지해 idle에 도달하지 못함.
        await page.goto('/employee/drive-log');

        // 차량 목록(VehicleSelector 그리드)이 뜰 때까지 대기 — 페이지 준비 신호로 충분
        const vehicleBtn = page.locator('.grid.grid-cols-3 button').first();
        await expect(vehicleBtn).toBeVisible({ timeout: 15000 });

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

        // 도착 km — 출발 km(차량 currentKm 자동 채움) + 42km.
        // 임의의 큰 값(999999)은 "한 번의 운행 10,000km 초과 금지" 검증에 걸려 제출이 거부된다.
        const startKmValue = await page.locator('input[type="number"]').first().inputValue();
        await page.locator('input[placeholder="12400"]').fill(String(Number(startKmValue || '0') + 42));

        // 저장 버튼 클릭
        await page.getByRole('button', { name: /운행일지 저장/ }).click();

        // 4. 오프라인 제출 계약 1 — 저장 즉시 오프라인 큐(sync-db/sync-store)에 적재된다.
        //    (createDriveLog 오프라인 분기: setDoc 백그라운드 발사 + enqueue)
        await expect.poll(() => queueCount(page), {
            message: '오프라인 저장이 sync-db/sync-store 큐에 적재되어야 합니다',
            timeout: 15000,
        }).toBeGreaterThan(0);

        // 오프라인 제출 성공 시 내비게이션 없이 폼이 리셋된다 (useDriveLogSubmit offline 분기)
        await expect(page.locator('input#destination')).toHaveValue('', { timeout: 10000 });

        // 5. 브라우저를 다시 온라인으로 전환
        await context.setOffline(false);
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
            window.dispatchEvent(new Event('online'));
        });

        // Firestore SDK가 백그라운드 setDoc을 재전송할 시간을 준다
        await page.waitForTimeout(3000);

        // 6. 오프라인 제출 계약 2 — 재접속 후 서버(에뮬레이터)에 실제 반영된다.
        //    내 기록 화면에서 문서가 조회되는지로 검증.
        //    (큐 flush는 SW sync 이벤트 전용이라 SW가 없는 dev 서버 E2E에선 검증 대상이 아님)
        await page.goto('/employee/my-records');
        await expect(page.locator('text=E2E 오프라인 목적지').first()).toBeVisible({ timeout: 20000 });
    });
});
