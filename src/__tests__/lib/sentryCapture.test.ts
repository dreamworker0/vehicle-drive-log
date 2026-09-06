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

/** init에 등록된 beforeBreadcrumb을 꺼낸다 — 순수 함수가 아니라 **배선**을 본다. */
async function loadBreadcrumbHook() {
    const { init } = await loadSentry();
    const options = init.mock.calls[0][0] as {
        beforeBreadcrumb: (b: Record<string, unknown>) => Record<string, unknown>;
    };
    return { beforeBreadcrumb: options.beforeBreadcrumb };
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

        // SDK가 실제로 만드는 모양을 그대로 쓴다 — data.arguments와 message를 **둘 다** 만들고
        // (integrations/breadcrumbs.js의 safeJoin), Sentry 화면이 보여 주는 건 message다.
        // 인자만 검사하는 테스트로는 message 누출이 보이지 않는다.
        const args: unknown[] = [
            '📋 승인된 기관 데이터:',
            '{"applicantName":"홍길동","applicantEmail":"hong@example.or.kr","applicantPhone":"010-1234-5678"}',
            { destination: '서울역', vehicleId: 'v1' },
        ];
        const scrubbed = options.beforeBreadcrumb({
            category: 'console',
            level: 'warning',
            data: { arguments: args, logger: 'console' },
            message: args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
        });

        const argsOut = JSON.stringify((scrubbed.data as { arguments: unknown[] }).arguments);
        const messageOut = scrubbed.message as string;

        for (const out of [argsOut, messageOut]) {
            expect(out).not.toContain('hong@example.or.kr');
            expect(out).not.toContain('010-1234-5678');
            expect(out).not.toContain('서울역');
        }
        // 개발자가 쓴 로그 문구와 식별자는 남아야 자취를 따라갈 수 있다
        expect(messageOut).toContain('승인된 기관 데이터');
        expect(argsOut).toContain('v1');
        // logger 등 SDK가 넣은 다른 필드는 보존한다
        expect((scrubbed.data as { logger: string }).logger).toBe('console');
    });

    it('요청 URL의 검색어를 지운다 — 목적지가 쿼리로 나간다', async () => {
        // 이 앱은 목적지 검색을 /api/tmap?...&keyword=... 로 보낸다. fetch breadcrumb은 URL을
        // 통째로 담으므로, extra를 아무리 걸러도 오류 직전 요청에 목적지가 실려 나갔다.
        const { beforeBreadcrumb } = await loadBreadcrumbHook();

        const out = beforeBreadcrumb({
            category: 'fetch',
            type: 'http',
            data: { method: 'GET', url: '/api/tmap?action=poi&keyword=김OO 어르신 댁', status_code: 500 },
        });

        const data = out.data as { url: string; method: string; status_code: number };
        expect(data.url).not.toContain('김OO');
        expect(data.url).toContain('action=poi');   // 어떤 호출이었는지는 남는다
        expect(data.method).toBe('GET');            // SDK가 넣은 다른 필드는 보존
        expect(data.status_code).toBe(500);
    });

    it('xhr도 같은 규칙으로 지운다', async () => {
        const { beforeBreadcrumb } = await loadBreadcrumbHook();
        const out = beforeBreadcrumb({ category: 'xhr', data: { url: '/api/x?q=서울역' } });
        expect((out.data as { url: string }).url).not.toContain('서울역');
    });

    it('클릭한 요소의 실명을 지운다 — SDK가 aria-label·title을 항상 붙인다', async () => {
        // _htmlElementAsString의 고정 목록이라 serializeAttribute 설정으로는 막을 수 없다.
        const { beforeBreadcrumb } = await loadBreadcrumbHook();

        const out = beforeBreadcrumb({
            category: 'ui.click',
            message: 'span.badge[title="공동 운전자: 홍길동, 김철수"]',
        });

        expect(out.message).toBe('span.badge[title]');
    });

    it('화면 이동 경로의 쿼리도 지우고, 없으면 그대로 둔다', async () => {
        const { beforeBreadcrumb } = await loadBreadcrumbHook();

        const plain = { category: 'navigation', data: { from: '/employee/today', to: '/employee/drive-log' } };
        expect(beforeBreadcrumb({ ...plain })).toEqual(plain);

        const withQuery = beforeBreadcrumb({ category: 'navigation', data: { from: '/a', to: '/b?q=홍길동' } });
        expect((withQuery.data as { to: string }).to).not.toContain('홍길동');
    });

    it('그 밖의 breadcrumb은 건드리지 않는다', async () => {
        const { beforeBreadcrumb } = await loadBreadcrumbHook();
        const other = { category: 'sentry.event', message: 'x', data: { url: '/a?q=1' } };
        expect(beforeBreadcrumb({ ...other })).toEqual(other);
    });
});
