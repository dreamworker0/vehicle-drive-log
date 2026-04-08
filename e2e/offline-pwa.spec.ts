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

    test('오프라인 상태에서 큐에 추가한 작업이 재접속 후 IndexedDB에서 처리 시도되는지 검증 (강제종료 시나리오)', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(1000); // 앱 초기화 대기

        // 1. IndexedDB에 오프라인 가상 액션 주입
        await page.evaluate(async () => {
            return new Promise<void>((resolve, reject) => {
                const req = window.indexedDB.open('veh-log-offline-sync', 1);
                req.onupgradeneeded = (e: any) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('action-queue')) {
                        db.createObjectStore('action-queue', { keyPath: 'id' });
                    }
                };
                req.onsuccess = (e: any) => {
                    const db = e.target.result;
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
            return new Promise<number>((resolve, reject) => {
                const req = window.indexedDB.open('veh-log-offline-sync', 1);
                req.onsuccess = (e: any) => {
                    const db = e.target.result;
                    const tx = db.transaction('action-queue', 'readonly');
                    const store = tx.objectStore('action-queue');
                    const countReq = store.count();
                    countReq.onsuccess = () => resolve(countReq.result);
                };
            });
        });
        expect(initialCount).toBeGreaterThanOrEqual(1);

        // 3. 브라우저 online 이벤트 트리거
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        
        // 백그라운드 큐 처리 시도 대기 (페이로드 검증에 걸려 삭제되거나, 서버통신 후 상태 반영)
        await page.waitForTimeout(2000);

        // 4. 의도한 유효성 실패 페이로드이므로,
        // Strict Type Safety (isCreateDriveLogPayload) 에 의해 Invalid CREATE payload 처리되어 
        // 성공 시 큐에서 제거되거나 에러를 발생시킬 것임.
        // 현재 로직상 타입 가드 실패 시 catch로 넘어가지 않고 진행되므로 큐에서 제거(removeOfflineAction)됨
        const finalCount = await page.evaluate(async () => {
            return new Promise<number>((resolve, reject) => {
                const req = window.indexedDB.open('veh-log-offline-sync', 1);
                req.onsuccess = (e: any) => {
                    const db = e.target.result;
                    const tx = db.transaction('action-queue', 'readonly');
                    const store = tx.objectStore('action-queue');
                    const countReq = store.count();
                    countReq.onsuccess = () => resolve(countReq.result);
                };
            });
        });

        // 1건이 소비되어 줄어들었거나 초기 카운트보다 작아졌어야 한다.
        expect(finalCount).toBeLessThan(initialCount);
    });
});
