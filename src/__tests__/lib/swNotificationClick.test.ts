/**
 * 서비스 워커 알림 클릭 — '어느 탭을 움직이는가'를 고정한다.
 *
 * 회귀 대상: 탭을 두 개 띄워두면 matchAll이 준 첫 번째 탭을 조건 없이 navigate + focus 해서,
 * 사용자가 보고 있지 않은 탭의 주소가 바뀌고 포커스까지 그쪽으로 튀었다.
 *
 * sw.ts는 import 시점에 workbox와 self에 손을 대므로, workbox는 모두 모킹하고
 * self.addEventListener를 가로채 등록된 notificationclick 핸들러를 직접 호출한다.
 */
import { vi, describe, it, expect, beforeEach, beforeAll } from 'vitest';

vi.mock('workbox-precaching', () => ({
    precacheAndRoute: vi.fn(),
    cleanupOutdatedCaches: vi.fn(),
    createHandlerBoundToURL: vi.fn(() => vi.fn()),
}));
vi.mock('workbox-routing', () => ({
    registerRoute: vi.fn(),
    NavigationRoute: class { },
}));
vi.mock('workbox-strategies', () => ({
    CacheFirst: class { },
    StaleWhileRevalidate: class { },
}));
vi.mock('workbox-expiration', () => ({
    ExpirationPlugin: class { },
}));
vi.mock('@/lib/offline/syncQueue', () => ({
    flushQueue: vi.fn(),
}));

type FakeClient = {
    url: string;
    focused: boolean;
    visibilityState: string;
    focus: ReturnType<typeof vi.fn>;
    navigate: ReturnType<typeof vi.fn>;
};

function makeClient(
    path: string,
    opts: { focused?: boolean; visible?: boolean; navigateRejects?: boolean } = {},
): FakeClient {
    return {
        url: absolute(path),
        focused: opts.focused ?? false,
        visibilityState: opts.visible || opts.focused ? 'visible' : 'hidden',
        focus: vi.fn().mockResolvedValue(undefined),
        navigate: opts.navigateRejects
            ? vi.fn().mockRejectedValue(new TypeError('client is not controlled'))
            : vi.fn().mockResolvedValue(undefined),
    };
}

/** jsdom origin에 맞춘 절대 URL — 하드코딩하면 환경에 따라 깨진다. */
function absolute(path: string) {
    return new URL(path, self.location.origin).href;
}

let notificationClick: (event: unknown) => void;
const matchAll = vi.fn();
const openWindow = vi.fn().mockResolvedValue(null);

beforeAll(async () => {
    const swGlobal = self as unknown as Record<string, unknown>;
    swGlobal.skipWaiting = vi.fn();
    swGlobal.registration = { navigationPreload: { disable: vi.fn() } };
    swGlobal.clients = { matchAll, openWindow };
    swGlobal.__WB_MANIFEST = [];

    const handlers: Record<string, (event: unknown) => void> = {};
    vi.spyOn(self, 'addEventListener').mockImplementation(
        (type: string, fn: unknown) => { handlers[type] = fn as (event: unknown) => void; },
    );

    await import('@/sw');
    notificationClick = handlers.notificationclick;
});

/** 알림 클릭을 흉내내고, 핸들러가 waitUntil에 넘긴 작업이 끝날 때까지 기다린다. */
async function clickNotification(clickAction: string | undefined, clients: FakeClient[]) {
    matchAll.mockResolvedValue(clients);
    let pending: Promise<unknown> = Promise.resolve();
    const close = vi.fn();
    notificationClick({
        notification: { close, data: clickAction === undefined ? {} : { click_action: clickAction } },
        waitUntil: (p: Promise<unknown>) => { pending = p; },
    });
    await pending;
    return { close };
}

beforeEach(() => {
    matchAll.mockReset();
    openWindow.mockClear();
});

describe('sw notificationclick — 대상 탭 선택', () => {
    it('핸들러가 등록되어 있다', () => {
        expect(typeof notificationClick).toBe('function');
    });

    it('포커스된 탭에서 이동하고, 보고 있지 않은 탭은 건드리지 않는다', async () => {
        const background = makeClient('/employee/today');
        const focusedTab = makeClient('/employee/my-records', { focused: true });

        await clickNotification('/employee/reservations', [background, focusedTab]);

        expect(focusedTab.navigate).toHaveBeenCalledWith(absolute('/employee/reservations'));
        expect(focusedTab.focus).toHaveBeenCalled();
        // 회귀 지점 — 배열 첫 번째(background)를 끌고 가면 안 된다
        expect(background.navigate).not.toHaveBeenCalled();
        expect(background.focus).not.toHaveBeenCalled();
        expect(openWindow).not.toHaveBeenCalled();
    });

    it('포커스는 없어도 보이는 탭이 있으면 그 탭을 쓴다', async () => {
        const hidden = makeClient('/employee/today');
        const visible = makeClient('/employee/my-records', { visible: true });

        await clickNotification('/employee/reservations', [hidden, visible]);

        expect(visible.navigate).toHaveBeenCalledWith(absolute('/employee/reservations'));
        expect(hidden.navigate).not.toHaveBeenCalled();
    });

    it('이미 그 페이지인 탭이 있으면 재로딩 없이 포커스만 한다', async () => {
        const onTarget = makeClient('/employee/reservations');
        const focusedTab = makeClient('/employee/today', { focused: true });

        await clickNotification('/employee/reservations', [onTarget, focusedTab]);

        expect(onTarget.focus).toHaveBeenCalled();
        // 상대 경로 click_action과 절대 URL client.url을 정규화해 비교하므로 navigate가 없다
        expect(onTarget.navigate).not.toHaveBeenCalled();
        expect(focusedTab.navigate).not.toHaveBeenCalled();
    });

    it('보이는 탭이 없으면 최근 포커스 탭(matchAll 첫 번째)을 재사용한다', async () => {
        const recent = makeClient('/employee/today');
        const older = makeClient('/admin/vehicles');

        await clickNotification('/employee/reservations', [recent, older]);

        expect(recent.navigate).toHaveBeenCalledWith(absolute('/employee/reservations'));
        expect(older.navigate).not.toHaveBeenCalled();
    });

    it('열린 탭이 없으면 새 창을 연다', async () => {
        await clickNotification('/employee/reservations', []);

        expect(openWindow).toHaveBeenCalledWith(absolute('/employee/reservations'));
    });

    it('navigate가 거부되면(제어하지 않는 탭) 새 창으로 폴백한다', async () => {
        const uncontrolled = makeClient('/employee/today', { focused: true, navigateRejects: true });

        await clickNotification('/employee/reservations', [uncontrolled]);

        expect(uncontrolled.navigate).toHaveBeenCalled();
        expect(openWindow).toHaveBeenCalledWith(absolute('/employee/reservations'));
    });

    it('click_action이 없으면 루트로 보낸다', async () => {
        const focusedTab = makeClient('/employee/today', { focused: true });

        await clickNotification(undefined, [focusedTab]);

        expect(focusedTab.navigate).toHaveBeenCalledWith(absolute('/'));
    });

    it('외부 origin click_action은 루트로 대체한다', async () => {
        const focusedTab = makeClient('/employee/today', { focused: true });

        await clickNotification('https://evil.example.com/steal', [focusedTab]);

        expect(focusedTab.navigate).toHaveBeenCalledWith(absolute('/'));
    });

    it('알림은 항상 닫는다', async () => {
        const { close } = await clickNotification('/employee/today', [
            makeClient('/employee/today', { focused: true }),
        ]);
        expect(close).toHaveBeenCalled();
    });
});
