import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * 스트림 스팬이 **실제 SDK 파이프라인을 거쳐** 걸러진 채 나가는지 확인한다.
 *
 * sentryCapture.test.ts는 init에 넘긴 `beforeSendSpan`을 직접 부른다 — 그래서 SDK가 그 콜백을
 * 아예 부르지 않는 경우(traceLifecycle과 콜백 모양이 어긋나면 SDK 11은 **오류 없이 건너뛴다**)는
 * 잡지 못한다. 여기서는 진짜 @sentry/react를 우리 init 옵션 그대로 띄우고(전송만 가로채고
 * 샘플링만 1로) 스팬을 만들어, 전송 직전 봉투(envelope)에 원본이 남았는지 본다.
 * 2026-10-17 static → stream 전환(운영자 결정)과 함께 넣었다.
 */

const DSN = 'https://examplekey@o0.ingest.sentry.io/1234567';
type Envelope = [Record<string, unknown>, Array<[{ type: string }, unknown]>];
const sent: Envelope[] = [];

let Sentry: typeof import('@sentry/react');

beforeAll(async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN);
    // jsdom에는 성능 타임라인이 없다 — browserTracing의 Web Vitals 계측이 부르다 터지지 않게 빈 값을 준다
    if (typeof performance.getEntriesByType !== 'function') {
        Object.defineProperty(performance, 'getEntriesByType', { configurable: true, value: () => [] });
    }
    const real = await vi.importActual<typeof import('@sentry/react')>('@sentry/react');
    Sentry = real;
    vi.doMock('../../lib/sentryClient', () => ({
        ...real,
        // 우리 옵션을 그대로 쓰되 네트워크 대신 봉투를 모으고, 표본을 전부 뽑는다(테스트에서는 0이다)
        init: (options: Record<string, unknown>) => real.init({
            ...options,
            tracesSampleRate: 1,
            transport: () => ({
                send: async (envelope: Envelope) => { sent.push(envelope); return { statusCode: 200 }; },
                flush: async () => true,
            }),
        }),
    }));
    const mod = await import('../../lib/sentry');
    mod.initSentry();
    await vi.waitFor(() => expect(real.getClient()).toBeDefined(), { timeout: 10_000 });
}, 60_000);

afterAll(async () => {
    await Sentry?.close();
    vi.unstubAllEnvs();
    vi.doUnmock('../../lib/sentryClient');
});

/** 보낸 봉투에서 스트림 스팬 묶음(span v2)의 항목을 모은다 */
function sentSpans(): Array<{ name: string; attributes: Record<string, { value: unknown }> }> {
    return sent.flatMap(([, items]) => items
        .filter(([header]) => header.type === 'span')
        .flatMap(([, payload]) => (payload as { items: Array<{ name: string; attributes: Record<string, { value: unknown }> }> }).items));
}

describe('스트림 스팬 — 실제 SDK 파이프라인', () => {
    it('traceLifecycle이 stream이고, 우리 beforeSendSpan이 실제로 불려 검색어·요소 설명·실명을 지운다', async () => {
        expect(Sentry.getClient()?.getOptions().traceLifecycle).toBe('stream');

        Sentry.startSpan({
            name: 'GET /api/tmap',
            op: 'http.client',
            attributes: {
                'url.full': 'https://vehicle-drive-log.web.app/api/tmap?action=poi&keyword=김OO 어르신 댁',
                'url.query': 'action=poi&keyword=김OO 어르신 댁',
                'http.request.method': 'GET',
            },
        }, () => {
            Sentry.startSpan({
                name: 'button.btn-icon[aria-label="홍길동 제거"]',
                op: 'ui.interaction.click',
                attributes: { 'browser.web_vital.inp.target': 'button[title="공동 운전자: 이영희"]' },
            }, () => undefined);
        });
        await Sentry.flush(5_000);

        const spans = sentSpans();
        expect(spans.length).toBeGreaterThanOrEqual(2);  // 스팬이 실제로 나갔다(검사가 헛돌지 않게)

        const json = JSON.stringify(spans);
        for (const leaked of ['김OO', '홍길동', '이영희']) expect(json).not.toContain(leaked);

        const http = spans.find((s) => s.name === 'GET /api/tmap')!;
        expect(http.attributes['http.request.method'].value).toBe('GET');
        expect(http.attributes.app.value).toBe('vehicle-drive-log');  // 다른 앱과 가려내는 속성(태그는 스트림에 안 실린다)
    });

    it('스팬 묶음의 IP 추정을 끄는 입력이 실제 클라이언트에 들어가 있다(userInfo: false)', () => {
        // core spans/envelope는 `getDataCollectionOptions().userInfo`가 거짓이면 infer_ip: 'never'를 싣는다.
        // 그 필드는 브라우저에서만 붙어(isBrowser) Node에서 도는 이 테스트로는 볼 수 없으므로 입력을 확인한다.
        const client = Sentry.getClient() as unknown as { getDataCollectionOptions: () => { userInfo: boolean } };
        expect(client.getDataCollectionOptions().userInfo).toBe(false);
    });
});
