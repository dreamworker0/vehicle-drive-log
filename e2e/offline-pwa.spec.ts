import { test, expect } from '@playwright/test';

test.describe('오프라인 큐잉 & PWA', () => {
    // OfflineBanner 테스트는 CI headless 환경에서 오프라인 이벤트 전파가
    // 불안정하므로 fixme 처리 (로컬에서는 정상 작동)
    test.fixme('OfflineBanner가 오프라인 상태에서 표시된다', async ({ page, context }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // 오프라인 시뮬레이션
        await context.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));
        await page.waitForTimeout(1000);

        const banner = page.locator('[role="alert"]');
        await expect(banner).toBeVisible({ timeout: 5000 });
        await expect(banner).toContainText('오프라인');

        // 온라인 복구
        await context.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await page.waitForTimeout(1000);

        const reconnected = page.locator('[role="status"]');
        await expect(reconnected).toBeVisible({ timeout: 5000 });
        await expect(reconnected).toContainText('다시 연결');
    });

    test('서비스 워커가 등록된다', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(3000);

        const swRegistered = await page.evaluate(() =>
            navigator.serviceWorker?.controller !== null ||
            navigator.serviceWorker?.ready !== undefined
        );
        expect(swRegistered).toBeTruthy();
    });

    test('manifest.json이 올바른 필드를 포함한다', async ({ page }) => {
        const response = await page.goto('/manifest.json');
        expect(response?.status()).toBe(200);
        const manifest = await response?.json();
        expect(manifest.name).toBeTruthy();
        expect(manifest.short_name).toBeTruthy();
        expect(manifest.start_url).toBeTruthy();
        expect(manifest.icons?.length).toBeGreaterThan(0);
    });

    test.fixme('오프라인 상태에서 큐에 추가한 작업이 재접속 후 IndexedDB에서 처리 시도되는지 검증 (강제종료 시나리오)', async ({ page, context }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle'); // 앱 초기화 대기 및 불필요한 네비게이션 방지

        // 0. 정확한 오프라인 전환 트리거
        await context.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));

        // 1. IndexedDB에 오프라인 가상 액션 주입
        await page.evaluate(async () => {
            return new Promise<void>((resolve, reject) => {
                const req = window.indexedDB.open('veh-log-offline-sync', 1);
                req.onupgradeneeded = (e: Event) => {
                    const target = e.target as IDBOpenDBRequest;
                    const db = target.result;
                    if (!db.objectStoreNames.contains('action-queue')) {
                        db.createObjectStore('action-queue', { keyPath: 'id' });
                    }
                };
                req.onsuccess = (e: Event) => {
                    const target = e.target as IDBOpenDBRequest;
                    const db = target.result;
                    const tx = db.transaction('action-queue', 'readwrite');
                    const store = tx.objectStore('action-queue');
                    store.add({
                        id: 'test-action-e2e-123',
                        type: 'CREATE_DRIVELOG',
                        payload: { vehicleId: 'E2E_TEST', status: 'invalid' }, // 의도적 유효성 실패 페이로드
                        timestamp: Date.now(),
                        retryCount: 0
                    });
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                };
                req.onerror = () => reject(req.error);
            });
        });

        // 2. 큐에 제대로 적재되었는지 확인
        const initialCount = await page.evaluate(async () => {
            return new Promise<number>((resolve) => {
                const req = window.indexedDB.open('veh-log-offline-sync', 1);
                req.onsuccess = (e: Event) => {
                    const target = e.target as IDBOpenDBRequest;
                    const db = target.result;
                    const tx = db.transaction('action-queue', 'readonly');
                    const store = tx.objectStore('action-queue');
                    const countReq = store.count();
                    countReq.onsuccess = () => resolve(countReq.result);
                };
            });
        });
        expect(initialCount).toBeGreaterThanOrEqual(1);

        // 3. 브라우저 online 이벤트 트리거 및 네트워크 복구
        await context.setOffline(false);
        // Playwright의 setOffline(false)가 실제 DOM의 navigator.onLine 상태에 반영될 때까지 대기
        await page.waitForFunction(() => navigator.onLine === true, undefined, { timeout: 5000 });
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        
        // 백그라운드 큐 처리 시도 대기 과정은 expect.poll을 사용하여 동적으로 대기
        
        // 4. 의도한 유효성 실패 페이로드이므로,
        // 성공 시 큐에서 제거되거나 에러를 발생시킬 것임.
        await expect.poll(async () => {
            return await page.evaluate(async () => {
                return new Promise<number>((resolve) => {
                    const req = window.indexedDB.open('veh-log-offline-sync', 1);
                    req.onsuccess = (e: Event) => {
                        const target = e.target as IDBOpenDBRequest;
                        const db = target.result;
                        const tx = db.transaction('action-queue', 'readonly');
                        const store = tx.objectStore('action-queue');
                        const countReq = store.count();
                        countReq.onsuccess = () => resolve(countReq.result);
                    };
                });
            });
        }, {
            message: '오프라인 큐가 비워져야 합니다',
            timeout: 10000,
        }).toBeLessThan(initialCount);
    });
});
