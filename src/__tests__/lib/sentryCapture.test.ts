import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * captureError / captureWarning이 **실제로** 스크러빙을 거쳐 보내는지 검증한다.
 *
 * sentryScrub.test.ts는 순수 함수만 본다. 그래서 sentry.ts에서 `scrubContext(context)`
 * 호출 한 줄을 지워도 그 스위트는 전부 초록이었다 — 모듈의 가치가 전부 그 한 줄에
 * 걸려 있는데 정작 그것만 회귀 방어가 없었다. 여기서 배선을 못박는다.
 */

const DSN = 'https://examplekey@o0.ingest.sentry.io/1234567';

/** captureError는 SDK를 동적 import하므로 mock 모듈과 함께 새로 로드한다 */
async function loadSentry() {
    const init = vi.fn();
    const captureException = vi.fn();
    const captureMessage = vi.fn();
    vi.doMock('../../lib/sentryClient', () => ({
        init,
        setUser: vi.fn(),
        setTag: vi.fn(),
        captureException,
        captureMessage,
        setMeasurement: vi.fn(),
        browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
    }));
    const mod = await import('../../lib/sentry');
    mod.initSentry();
    await vi.waitFor(() => expect(init).toHaveBeenCalled());
    return { mod, init, captureException, captureMessage };
}

describe('captureError / captureWarning — 개인정보 스크러빙 배선', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv('VITE_SENTRY_DSN', DSN);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        vi.doUnmock('../../lib/sentryClient');
    });

    it('captureError가 extra의 자유 입력을 지우고 보낸다', async () => {
        const { mod, captureException } = await loadSentry();

        mod.captureError(new Error('permission-denied'), {
            context: 'createDriveLog',
            orgId: 'org1',
            data: { destination: '서울시청', notes: '김OO 어르신 진료' },
        });

        await vi.waitFor(() => expect(captureException).toHaveBeenCalled());
        const [, options] = captureException.mock.calls[0];
        const serialized = JSON.stringify(options.extra);

        expect(serialized).not.toContain('서울시청');
        expect(serialized).not.toContain('어르신');
        expect(options.extra.context).toBe('createDriveLog');
        expect(options.extra.orgId).toBe('org1');
    });

    it('captureWarning도 같은 규칙으로 지우고 보낸다', async () => {
        const { mod, captureMessage } = await loadSentry();

        mod.captureWarning('[Auth] 세션 종료', {
            uid: 'u1',
            lastEmail: 'jw@example.com',
        });

        await vi.waitFor(() => expect(captureMessage).toHaveBeenCalled());
        const [, options] = captureMessage.mock.calls[0];

        expect(JSON.stringify(options.extra)).not.toContain('example.com');
        expect(options.extra.uid).toBe('u1');
    });

    it('init에 등록한 beforeBreadcrumb이 console 인자에서 자유 입력을 지운다', async () => {
        // console 호출은 SDK 기본 breadcrumbsIntegration이 인자 객체를 그대로 담아
        // 다음 이벤트에 붙인다. extra만 걸러서는 막히지 않는 경로다.
        const { init } = await loadSentry();
        const options = init.mock.calls[0][0] as {
            beforeBreadcrumb: (b: Record<string, unknown>) => Record<string, unknown>;
        };

        const scrubbed = options.beforeBreadcrumb({
            category: 'console',
            level: 'warning',
            data: { arguments: ['[submitDriveLog] 실패', { destination: '서울역', vehicleId: 'v1' }] },
        });

        const serialized = JSON.stringify((scrubbed.data as { arguments: unknown[] }).arguments);
        expect(serialized).not.toContain('서울역');
        expect(serialized).toContain('v1');
    });

    it('console 이외의 breadcrumb은 건드리지 않는다', async () => {
        const { init } = await loadSentry();
        const options = init.mock.calls[0][0] as {
            beforeBreadcrumb: (b: Record<string, unknown>) => Record<string, unknown>;
        };

        const navigation = { category: 'navigation', data: { from: '/employee/today', to: '/employee/drive-log' } };
        expect(options.beforeBreadcrumb({ ...navigation })).toEqual(navigation);
    });
});
