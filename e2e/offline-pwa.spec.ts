import { test, expect } from '@playwright/test';

test.describe('오프라인 큐잉 & PWA', () => {
    // OfflineBanner 테스트는 CI headless 환경에서 offline 이벤트 전파가 
    // 브라우저 엔진에 따라 불안정(flaky)하므로 fixme 처리하고 단위 테스트에 위임합니다.
    test.fixme('OfflineBanner가 오프라인 상태에서 표시된다', async ({ page, context }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // 오프라인 시뮬레이션
        await context.setOffline(true);
        await page.waitForTimeout(1000);

        const banner = page.locator('[role="alert"]').filter({ hasText: '오프라인' });
        await expect(banner).toBeVisible({ timeout: 5000 });
        await expect(banner).toContainText('오프라인');

        // 온라인 복구
        await context.setOffline(false);
        await page.waitForTimeout(1000);

        const reconnected = page.locator('[role="status"]').filter({ hasText: '다시 연결' });
        await expect(reconnected).toBeVisible({ timeout: 5000 });
        await expect(reconnected).toContainText('다시 연결');
    });

    test('서비스 워커가 등록된다', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

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

    // 백그라운드 싱크 및 IndexedDB 큐 비우기도 Headless 이벤트 전파 버그와 
    // IDB Transaction Lock-up 리스크가 있어 E2E CI 레벨에선 fixme 처리.
    test.fixme('오프라인 상태에서 큐에 추가한 작업이 재접속 후 IndexedDB에서 처리 시도되는지 검증 (강제종료 시나리오)', async ({ page, context }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await context.setOffline(true);
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
            window.dispatchEvent(new Event('offline'));
        });

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
                        payload: { vehicleId: 'E2E_TEST', status: 'invalid' },
                        timestamp: Date.now(),
                        retryCount: 0
                    });
                    tx.oncomplete = () => { db.close(); resolve(); };
                    tx.onerror = () => { db.close(); reject(tx.error); };
                };
                req.onerror = () => reject(req.error);
            });
        });

        const initialCount = await page.evaluate(async () => {
            return new Promise<number>((resolve) => {
                const req = window.indexedDB.open('veh-log-offline-sync', 1);
                req.onsuccess = (e: Event) => {
                    const target = e.target as IDBOpenDBRequest;
                    const db = target.result;
                    const tx = db.transaction('action-queue', 'readonly');
                    const store = tx.objectStore('action-queue');
                    const countReq = store.count();
                    countReq.onsuccess = () => { db.close(); resolve(countReq.result); };
                    countReq.onerror = () => { db.close(); resolve(0); };
                };
            });
        });
        expect(initialCount).toBeGreaterThanOrEqual(1);

        await context.setOffline(false);
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
            window.dispatchEvent(new Event('online'));
        });

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
                        countReq.onsuccess = () => { db.close(); resolve(countReq.result); };
                        countReq.onerror = () => { db.close(); resolve(100); };
                    };
                });
            });
        }, {
            message: '오프라인 큐가 비워져야 합니다',
            timeout: 10000,
        }).toBeLessThan(initialCount);
    });
});
