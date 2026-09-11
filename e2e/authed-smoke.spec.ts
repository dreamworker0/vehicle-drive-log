import { test, expect, type Page } from '@playwright/test';
import { TEST_ADMIN, TEST_EMPLOYEE } from './emulator/seed';

/**
 * 인증 상태 E2E (에뮬레이터 전용 — playwright.emulator.config.ts).
 *
 * Google 로그인 전용 앱이라 OAuth 팝업을 자동화할 수 없으므로, 에뮬레이터 모드에서
 * 앱이 window에 노출하는 __E2E_AUTH__.signIn(이메일/비번)으로 실제 로그인 세션을 만든다.
 * 그러면 useAuth의 onAuthStateChanged → users 구독 → claims 갱신이 정상 동작하고,
 * 랜딩(requireGuest)에서 역할별 대시보드로 자동 리다이렉트된다.
 */

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
    // 에뮬레이터 모드에서 로그인 헬퍼가 window에 노출될 때까지 대기
    await page.waitForFunction(() => !!window.__E2E_AUTH__, null, { timeout: 15000 });
    // 로그인 트리거만 하고 반환 promise는 기다리지 않는다.
    // 로그인 성공 즉시 requireGuest 가드가 리다이렉트를 일으켜 evaluate 컨텍스트가
    // 파괴될 수 있으므로, 결과는 호출부의 waitForURL로 확인한다.
    await page.evaluate(
        ([e, p]) => { void window.__E2E_AUTH__!.signIn(e, p); },
        [email, password] as const,
    ).catch(() => { /* 네비게이션으로 인한 컨텍스트 파괴 무시 */ });
}

/** Firebase 세션이 어느 저장소에 몇 개 있는지 — 저장 위치 회귀를 잡는 데 쓴다. */
async function readAuthStorage(page: Page) {
    return page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('firebaseLocalStorageDb');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        // 앱이 부팅하기 전이면 DB만 있고 스토어가 없다 — 던지면 expect.poll이 재시도하지 못한다.
        const keys = db.objectStoreNames.contains('firebaseLocalStorage')
            ? await new Promise<IDBValidKey[]>((resolve, reject) => {
                const req = db.transaction('firebaseLocalStorage', 'readonly')
                    .objectStore('firebaseLocalStorage').getAllKeys();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            })
            : [];
        db.close();
        return {
            idb: keys.map(String).filter((k) => k.startsWith('firebase:authUser:')).length,
            localStorage: Object.keys(localStorage).filter((k) => k.startsWith('firebase:authUser:')).length,
        };
    });
}

/** 브라우저 콘솔에서 Firestore 시드 계약 위반(`[Zod]` 파싱 실패)을 수집한다. */
function collectZodErrors(page: Page): string[] {
    const zodErrors: string[] = [];
    page.on('console', (message) => {
        if (message.type() === 'error' && message.text().includes('[Zod]')) {
            zodErrors.push(message.text());
        }
    });
    return zodErrors;
}

test.describe('인증 상태 E2E (에뮬레이터)', () => {
    test('직원 로그인 시 직원 대시보드로 자동 진입한다', async ({ page }) => {
        const zodErrors = collectZodErrors(page);
        await signIn(page, TEST_EMPLOYEE.email, TEST_EMPLOYEE.password);
        await page.waitForURL(/\/employee/, { timeout: 25000 });
        await expect(page).toHaveURL(/\/employee/);
        // 시드 데이터가 스키마 계약을 지키면 Zod 파싱 오류가 0건이어야 한다.
        expect(zodErrors).toEqual([]);
    });

    test('관리자 로그인 시 관리자 화면으로 자동 진입한다', async ({ page }) => {
        await signIn(page, TEST_ADMIN.email, TEST_ADMIN.password);
        await page.waitForURL(/\/admin/, { timeout: 25000 });
        await expect(page).toHaveURL(/\/admin/);
    });

    test('직원이 관리자 전용 화면에 접근하면 직원 화면으로 돌려보낸다', async ({ page }) => {
        await signIn(page, TEST_EMPLOYEE.email, TEST_EMPLOYEE.password);
        await page.waitForURL(/\/employee/, { timeout: 25000 });
        // 권한 없는 /admin 직접 접근 → AuthGuard가 /employee로 리다이렉트.
        // 가드 리다이렉트가 네비게이션 도중 발동하면 goto가 net::ERR_ABORTED로 중단될 수 있으므로
        // 이를 허용하고, 최종 URL 단언으로 리다이렉트 결과를 검증한다(signIn의 catch와 동일 이유).
        await page.goto('/admin').catch(() => { /* 리다이렉트로 인한 네비게이션 중단 무시 */ });
        await expect(page).toHaveURL(/\/employee/, { timeout: 15000 });
    });

    /**
     * 세션을 어디에 두는지를 고정한다.
     *
     * 예전에는 setPersistence(browserLocalPersistence)로 저장 위치를 localStorage에 고정했다.
     * 모바일에서 Firebase의 localStorage 구현은 storage 이벤트 대신 1초 폴링으로 바뀌고,
     * 그 읽기가 한 번 비면 재시도 없이 로그아웃으로 직행한다 — 휴대폰 PWA에서 "잠깐 뒀다
     * 다시 열었더니 로그아웃"의 경로다. 기본값(IndexedDB 우선)으로 되돌렸고, 그 되돌림이
     * 조용히 뒤집히지 않도록 여기서 못을 박는다. 근거는 lib/firebaseAuth.ts 주석.
     */
    test('세션은 IndexedDB에 저장된다 (localStorage 고정으로 되돌아가지 않는다)', async ({ page }) => {
        await signIn(page, TEST_EMPLOYEE.email, TEST_EMPLOYEE.password);
        await page.waitForURL(/\/employee/, { timeout: 25000 });

        await expect.poll(() => readAuthStorage(page), { timeout: 15000 })
            .toEqual({ idb: 1, localStorage: 0 });
    });

    /**
     * 기존 사용자가 이 변경으로 로그아웃되지 않는지 확인한다.
     *
     * 이전 빌드는 세션을 localStorage에 두었다. 새 빌드가 그 세션을 못 읽으면 200여 기관의
     * 사용자가 한 번에 로그아웃된다 — 이 변경에서 가장 값비싼 실패다. Firebase의
     * PersistenceUserManager.create가 우선순위 목록 전체를 뒤져 세션을 찾고 1순위로 옮겨
     * 쓰기 때문에 그런 일이 없어야 하는데(@firebase/auth), 코드를 읽은 것에 더해 실제로도
     * 그런지 본다.
     *
     * **살아 있는 탭의 저장소를 건드리지 않는다.** 처음에는 이 탭에서 세션을 옮기고
     * 새로고침했는데, 지우는 순간 앱이 그 자리에서 로그아웃 처리를 시작해(IndexedDB
     * 폴링 → 유예 → /login 리다이렉트) 새로고침과 경쟁했다. 로컬에서는 통과하고 CI에서
     * `net::ERR_ABORTED`로 깨졌다. 대신 **옛 상태를 그대로 심은 새 브라우저 컨텍스트**를
     * 띄운다 — 세션이 localStorage에만 있는 채로 앱이 처음 부팅하는, 바로 그 상황이다.
     */
    test('예전 빌드가 localStorage에 남긴 세션은 그대로 이관된다 (기존 사용자 강제 로그아웃 없음)', async ({ page, browser }) => {
        await signIn(page, TEST_EMPLOYEE.email, TEST_EMPLOYEE.password);
        await page.waitForURL(/\/employee/, { timeout: 25000 });
        await expect.poll(() => readAuthStorage(page), { timeout: 15000 })
            .toEqual({ idb: 1, localStorage: 0 });

        // 세션 사본을 읽기만 한다(이 탭은 그대로 둔다)
        const session = await page.evaluate(async () => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const req = indexedDB.open('firebaseLocalStorageDb');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            const records = await new Promise<Array<{ fbase_key: string; value: unknown }>>((resolve, reject) => {
                const req = db.transaction('firebaseLocalStorage', 'readonly')
                    .objectStore('firebaseLocalStorage').getAll();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            db.close();
            const record = records.find((r) => r.fbase_key.startsWith('firebase:authUser:'));
            return record ? { key: record.fbase_key, value: JSON.stringify(record.value) } : null;
        });
        expect(session).not.toBeNull();

        // 옛 빌드가 남긴 상태 그대로 — localStorage에만 세션이 있는 새 컨텍스트
        const origin = new URL(page.url()).origin;
        const legacy = await browser.newContext({
            baseURL: origin,
            storageState: {
                cookies: [],
                origins: [{ origin, localStorage: [{ name: session!.key, value: session!.value }] }],
            },
        });
        try {
            const legacyPage = await legacy.newPage();
            await legacyPage.goto('/employee/today');

            // 이관은 부팅 중에 일어난다 — 저장소로 확인한다
            await expect.poll(() => readAuthStorage(legacyPage), { timeout: 25000 })
                .toEqual({ idb: 1, localStorage: 0 });

            // 세션을 못 읽었다면 AuthGuard가 /login으로 보냈을 것이다 — 남아 있다
            await expect(legacyPage).toHaveURL(/\/employee/);
        } finally {
            await legacy.close();
        }
    });
});
