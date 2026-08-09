/**
 * sentry.test.ts — captureError의 알림 경로 분리 검증
 *
 * core/sentry는 모듈 로드 시점에 process.env를 읽으므로(DSN·IS_TEST 상수),
 * 각 케이스마다 resetModules + env 교체 후 require한다.
 */

describe('captureError — Sentry와 Discord는 독립된 경로다', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        // NODE_ENV가 'test'면 captureError가 통째로 noop이므로 운영 환경을 흉내낸다.
        process.env = { ...OLD_ENV, NODE_ENV: 'production' };
    });

    afterEach(() => {
        process.env = OLD_ENV;
        jest.restoreAllMocks();
    });

    function loadWithMockedDiscord() {
        const sendDiscordAlert = jest.fn().mockResolvedValue(undefined);
        jest.doMock('../core/discord', () => ({ sendDiscordAlert }));
         
        const mod = require('../core/sentry');
        return { sendDiscordAlert, captureError: mod.captureError as (e: unknown, c?: Record<string, unknown>) => void };
    }

    it('SENTRY_DSN_FUNCTIONS가 없어도 Discord 알림은 발송된다 (회귀 가드)', () => {
        // 과거 조건이 `DSN && !IS_TEST`라, DSN이 비면 웹훅 URL을 정확히 넣어도
        // 알림이 한 건도 나가지 않았다. 이 케이스가 그 회귀를 막는다.
        delete process.env.SENTRY_DSN_FUNCTIONS;
        const { sendDiscordAlert, captureError } = loadWithMockedDiscord();

        captureError(new Error('백업 실패'), { context: 'dailyNightlyBatch', step: 'backupFirestore' });

        expect(sendDiscordAlert).toHaveBeenCalledTimes(1);
        const arg = sendDiscordAlert.mock.calls[0][0];
        expect(arg.title).toContain('Cloud Functions Exception');
        expect(arg.description).toContain('백업 실패');
        expect(arg.description).toContain('backupFirestore');
    });

    it('DSN이 설정된 경우에도 Discord 알림은 그대로 발송된다', () => {
        process.env.SENTRY_DSN_FUNCTIONS = 'https://examplePublicKey@o0.ingest.sentry.io/0';
        const { sendDiscordAlert, captureError } = loadWithMockedDiscord();

        captureError(new Error('boom'));

        expect(sendDiscordAlert).toHaveBeenCalledTimes(1);
    });

    it('테스트 환경(NODE_ENV=test)에서는 어떤 알림도 보내지 않는다', () => {
        process.env = { ...OLD_ENV, NODE_ENV: 'test' };
        const { sendDiscordAlert, captureError } = loadWithMockedDiscord();

        captureError(new Error('boom'));

        expect(sendDiscordAlert).not.toHaveBeenCalled();
    });

    it('Error가 아닌 값도 문자열로 변환해 발송한다', () => {
        delete process.env.SENTRY_DSN_FUNCTIONS;
        const { sendDiscordAlert, captureError } = loadWithMockedDiscord();

        captureError('문자열 오류');

        expect(sendDiscordAlert.mock.calls[0][0].description).toContain('문자열 오류');
    });

    it('Discord 발송이 실패해도 captureError는 예외를 던지지 않는다', () => {
        delete process.env.SENTRY_DSN_FUNCTIONS;
        const sendDiscordAlert = jest.fn().mockRejectedValue(new Error('webhook down'));
        jest.doMock('../core/discord', () => ({ sendDiscordAlert }));
         
        const { captureError } = require('../core/sentry');

        expect(() => captureError(new Error('boom'))).not.toThrow();
    });
});
