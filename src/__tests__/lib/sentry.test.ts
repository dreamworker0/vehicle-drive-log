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
