/**
 * sentry.test — 프런트엔드 Sentry 초기화의 릴리즈 태깅
 *
 * 릴리즈(배포 커밋 SHA)가 붙어야 Sentry가 "이 에러가 어느 배포에서 났는지"를 알고,
 * 이슈를 **Resolved in next release**로 닫을 수 있다. 릴리즈가 하나도 없는 프로젝트에서는
 * 그 조작이 `Unable to update issues`로 실패한다(2026-08-26 실제 발생).
 *
 * 값은 배포 워크플로가 빌드 시 `VITE_SENTRY_RELEASE`로 주입한다. init에서 이 값을 흘리면
 * 주입 자체가 무의미해지므로 여기서 고정한다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const DSN = 'https://examplekey@o0.ingest.sentry.io/1234567';

/** initSentry는 SDK를 동적 import하므로 mock 모듈과 함께 새로 로드한다 */
async function loadSentry() {
    const init = vi.fn();
    vi.doMock('../../lib/sentryClient', () => ({
        init,
        setUser: vi.fn(),
        setTag: vi.fn(),
        captureException: vi.fn(),
        setMeasurement: vi.fn(),
        browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
    }));
    const mod = await import('../../lib/sentry');
    mod.initSentry();
    await vi.waitFor(() => expect(init).toHaveBeenCalled());
    return init.mock.calls[0][0] as Record<string, unknown>;
}

describe('initSentry — 릴리즈 태깅', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv('VITE_SENTRY_DSN', DSN);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.doUnmock('../../lib/sentryClient');
    });

    it('VITE_SENTRY_RELEASE가 있으면 init에 release로 전달한다', async () => {
        vi.stubEnv('VITE_SENTRY_RELEASE', 'abc123def456');

        const options = await loadSentry();

        expect(options.dsn).toBe(DSN);
        expect(options.release).toBe('abc123def456');
    });

    it('값이 없으면 release 키를 넘기지 않는다 (SDK 기본 동작 유지)', async () => {
        vi.stubEnv('VITE_SENTRY_RELEASE', '');

        const options = await loadSentry();

        expect(options).not.toHaveProperty('release');
    });
});

/**
 * ignoreErrors — 종료(teardown) 레이스 노이즈
 *
 * Firestore를 의도적으로 `terminate()`하는 경로(logout→clearOfflineCache)에서 SDK 내부
 * 영속성 큐의 잔여 IDB 요청이 뒤늦게 거부되며 unhandledrejection으로 올라온다. 앱 쪽은
 * 이미 try/catch로 잡고 진행하므로 보고만 줄이면 되는데, **메시지 모양이 조금 달라도
 * 필터가 빗나간다**는 것이 실제로 드러났다 — 앵커 정규식 `/^Internal error\.?$/`가 있는데도
 * Firestore가 감싼 판(`IndexedDB transaction 'shutdown' failed: …`)이 새 이슈로 떴다
 * (Sentry JAVASCRIPT-REACT-6D, Edge 133/Windows).
 *
 * 그래서 **프로덕션에서 실제로 올라온 문자열 그대로** 고정한다. 필터를 정리하다 문구가
 * 바뀌면 여기서 먼저 깨진다.
 */
describe('initSentry — 종료 레이스 노이즈 필터', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv('VITE_SENTRY_DSN', DSN);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.doUnmock('../../lib/sentryClient');
    });

    /** ignoreErrors 항목(정규식·문자열 혼용)에 하나라도 걸리는지 */
    const isIgnored = (patterns: Array<RegExp | string>, message: string) =>
        patterns.some(p => (p instanceof RegExp ? p.test(message) : message.includes(p)));

    it("terminate() 중 감싸인 IndexedDB 오류를 걸러낸다 (프로덕션 실측 문자열)", async () => {
        const options = await loadSentry();
        const patterns = options.ignoreErrors as Array<RegExp | string>;

        expect(isIgnored(
            patterns,
            "IndexedDbTransactionError: IndexedDB transaction 'shutdown' failed: UnknownError: Internal error.",
        )).toBe(true);
    });

    it("종료 레이스가 아닌 트랜잭션 실패는 걸러내지 않는다", async () => {
        const options = await loadSentry();
        const patterns = options.ignoreErrors as Array<RegExp | string>;

        // 트랜잭션 이름을 'shutdown'으로 좁힌 것이 의도다 — 다른 트랜잭션의 실패는
        // 종료 레이스가 아니라 실제 영속성 문제일 수 있으므로 덮지 않는다.
        expect(isIgnored(
            patterns,
            "IndexedDbTransactionError: IndexedDB transaction 'Get next mutation batch' failed: UnknownError: Internal error.",
        )).toBe(false);
    });

    it("기존 teardown 계열도 그대로 걸러낸다 (회귀 방지)", async () => {
        const options = await loadSentry();
        const patterns = options.ignoreErrors as Array<RegExp | string>;

        expect(isIgnored(patterns, 'FirebaseError: Firestore shutting down')).toBe(true);
        expect(isIgnored(patterns, 'UnknownError: Connection is closing.')).toBe(true);
        expect(isIgnored(patterns, 'Internal error.')).toBe(true);
    });
});
