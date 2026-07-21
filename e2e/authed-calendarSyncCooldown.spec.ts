import { test, expect, type Page, type Route } from '@playwright/test';
import { TEST_EMPLOYEE, TEST_CALENDAR_VEHICLE, seedCalendarLinkedVehicle, deleteCalendarLinkedVehicle } from './emulator/seed';

/**
 * 구글 캘린더 온디맨드 동기화 쿨다운/재시도 UI 차단 E2E (에뮬레이터 전용).
 *
 * 실제 로직(useCalendarSync + triggerOnDemandCalendarSync)을 다음 두 계약으로 검증한다.
 *   1) 클라이언트 30분 쿨다운(useCalendarSync.COOLDOWN_MS) — 최근 동기화 이력이 있으면
 *      예약 페이지 진입 시 배경 자동 동기화 콜러블을 호출하지 않는다(재시도 억제).
 *   2) 서버 쿨다운/영구제외(calendarFailTracking: failCount>=3 → 24h, >=10 → 영구)가
 *      콜러블 응답 errorType:'calendar-not-found'로 표면화되면, 수동 '지금 동기화'는
 *      쿨다운을 우회해 1회만 호출하고 지수 백오프(2s→4s→8s) 재시도 없이 경고를 노출한다.
 *
 * functions 에뮬레이터는 test:e2e:emulator에서 실행되지 않으므로(authed-driveLogCreate 참고),
 * 콜러블 HTTP 엔드포인트를 page.route로 가로채 서버 응답을 결정적으로 모킹한다.
 * (서버의 24h/failCount 판정 로직 자체는 functions 단위 테스트가 커버하며, 여기서는
 *  그 판정이 반환하는 응답에 UI가 올바르게 반응하는지 — "UI 차단" 계약 — 만 본다.)
 */

declare global {
    interface Window {
        __E2E_AUTH__?: {
            signIn: (email: string, password: string) => Promise<unknown>;
            signOut: () => Promise<void>;
        };
    }
}

// 콜러블 v2 엔드포인트(functions 에뮬레이터 5001, region asia-northeast3). project id에
// 무관하게 함수명으로 매칭한다. 성공 200 응답의 바디는 콜러블 규약상 { result: <data> }.
const CALLABLE_GLOB = '**/triggerOnDemandCalendarSync';
const NOT_FOUND_RESULT = {
    success: false,
    errorType: 'calendar-not-found',
    message: '캘린더에 접근할 수 없습니다. 구글 캘린더가 서비스 계정에 \'변경 권한\'으로 공유되어 있는지 확인해주세요.',
};

async function signIn(page: Page, email: string, password: string) {
    await page.goto('/');
    await page.waitForFunction(() => !!window.__E2E_AUTH__, null, { timeout: 15000 });
    await page.evaluate(
        ([e, p]) => { void window.__E2E_AUTH__!.signIn(e, p); },
        [email, password] as const,
    ).catch(() => { /* 네비게이션으로 인한 컨텍스트 파괴 무시 */ });
}

/**
 * 콜러블을 가로채 calendar-not-found를 반환한다. POST 호출 횟수를 카운트하고,
 * CORS 프리플라이트(OPTIONS)는 허용 헤더로 응답해 브라우저가 POST를 막지 않게 한다.
 * (프리플라이트를 처리하지 않으면 콜러블이 일반 오류로 떨어져 3회 재시도되어 계약이 흐려진다.)
 */
async function mockCallable(page: Page): Promise<{ count: () => number }> {
    let count = 0;
    await page.route(CALLABLE_GLOB, async (route: Route) => {
        const req = route.request();
        const origin = req.headers()['origin'] || '*';
        const corsHeaders = {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };
        if (req.method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: corsHeaders });
            return;
        }
        count += 1;
        await route.fulfill({
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ result: NOT_FOUND_RESULT }),
        });
    });
    return { count: () => count };
}

/** 예약 페이지에 진입해 '지금 동기화' 컨트롤(=캘린더 연동 차량 로드 완료 신호)이 뜰 때까지 대기. */
async function gotoReservations(page: Page) {
    // 첫 실행은 vite 콜드 컴파일(auth+라우팅 그래프)로 로그인→리다이렉트가 25s를 넘길 수 있다
    // (playwright.emulator.config.ts 참고). 제품 버그가 아닌 타이밍이므로 재시도로 흡수한다.
    await expect(async () => {
        await signIn(page, TEST_EMPLOYEE.email, TEST_EMPLOYEE.password);
        await page.waitForURL(/\/employee/, { timeout: 20000 });
    }).toPass({ timeout: 60000 });
    await expect(async () => {
        await page.goto('/employee/reservations', { waitUntil: 'commit' }).catch(() => { /* 리다이렉트 중단 무시 */ });
        await expect(page).toHaveURL(/\/employee\/reservations/, { timeout: 3000 });
    }).toPass({ timeout: 25000 });
    await expect(page.getByRole('button', { name: '구글 캘린더 지금 동기화' })).toBeVisible({ timeout: 20000 });
}

test.describe('구글 캘린더 동기화 쿨다운/재시도 E2E (에뮬레이터)', () => {
    // 콜드 컴파일 재시도(gotoReservations)를 감안해 기본(45s)보다 넉넉히 잡는다.
    test.describe.configure({ timeout: 120000 });

    test.beforeAll(async () => {
        await seedCalendarLinkedVehicle();
    });
    test.afterAll(async () => {
        await deleteCalendarLinkedVehicle();
    });

    test('최근 동기화 이력(30분 쿨다운)이 있으면 예약 페이지 진입 시 배경 자동 동기화를 호출하지 않는다', async ({ page }) => {
        // 클라이언트 쿨다운 맵을 최근 시각으로 심어 배경 자동 동기화가 스킵되게 한다.
        // (useCalendarSync.checkCooldown이 localStorage의 last_calendar_sync_time_map을 읽는다.)
        await page.addInitScript((vehicleId) => {
            localStorage.setItem('last_calendar_sync_time_map', JSON.stringify({ [vehicleId]: Date.now() }));
        }, TEST_CALENDAR_VEHICLE.id);

        const callable = await mockCallable(page);
        await gotoReservations(page);

        // 배경 동기화 effect가 실행될 시간을 충분히 준 뒤에도 콜러블이 호출되지 않아야 한다.
        await page.waitForTimeout(2500);
        expect(callable.count()).toBe(0);
    });

    test('수동 "지금 동기화"는 쿨다운을 우회해 1회만 호출하고, 서버 접근 불가 시 재시도 없이 경고를 노출한다', async ({ page }) => {
        // 배경 자동 동기화는 쿨다운으로 억제해 두어, 이어지는 호출 카운트가 수동 클릭분만
        // 반영되도록 격리한다.
        await page.addInitScript((vehicleId) => {
            localStorage.setItem('last_calendar_sync_time_map', JSON.stringify({ [vehicleId]: Date.now() }));
        }, TEST_CALENDAR_VEHICLE.id);

        const callable = await mockCallable(page);
        await gotoReservations(page);

        // 진입 직후 배경 호출이 없었음을 확인(쿨다운 억제)한 뒤 수동 동기화를 실행한다.
        await page.waitForTimeout(1500);
        expect(callable.count()).toBe(0);

        await page.getByRole('button', { name: '구글 캘린더 지금 동기화' }).click();

        // 서버가 calendar-not-found를 알리면 syncNow는 경고 토스트를 노출한다.
        await expect(page.locator('text=동기화하지 못했습니다').first()).toBeVisible({ timeout: 15000 });

        // force는 쿨다운을 우회해 1회 호출한다. calendar-not-found는 설정 오류라 지수 백오프
        // 재시도(2s→4s→8s)를 하지 않으므로, 백오프 창을 지나도 호출은 1회에 머문다.
        expect(callable.count()).toBe(1);
        await page.waitForTimeout(3000);
        expect(callable.count()).toBe(1);
    });
});
