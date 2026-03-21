/**
 * sentry.ts — Cloud Functions Sentry 초기화
 *
 * @sentry/node로 서버사이드 에러를 수집한다.
 * 프론트엔드와 같은 Sentry 프로젝트를 사용하되,
 * environment: 'cloud-functions' 태그로 구분한다.
 *
 * 테스트 환경(NODE_ENV=test)에서는 Sentry를 초기화하지 않고
 * captureError/flushSentry는 noop으로 동작한다.
 */

const DSN = process.env.SENTRY_DSN_FUNCTIONS || "";
const IS_TEST = process.env.NODE_ENV === "test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sentry: any = null;

if (DSN && !IS_TEST) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        _sentry = require("@sentry/node");
        _sentry.init({
            dsn: DSN,
            environment: "cloud-functions",
            tracesSampleRate: 0,
        });
    } catch {
        // @sentry/node 로드 실패 시 무시
    }
}

/**
 * Sentry에 에러를 전송한다.
 * DSN이 설정되지 않거나 테스트 환경이면 아무것도 하지 않는다.
 */
export function captureError(error: unknown, context: Record<string, unknown> = {}): void {
    if (!_sentry) return;
    if (error instanceof Error) {
        _sentry.captureException(error, { extra: context });
    } else {
        _sentry.captureMessage(String(error), {
            level: "error",
            extra: context,
        });
    }
}

/**
 * Sentry에 경고 메시지를 전송한다.
 */
export function captureWarning(message: string, context: Record<string, unknown> = {}): void {
    if (!_sentry) return;
    _sentry.captureMessage(message, {
        level: "warning",
        extra: context,
    });
}

/**
 * 비동기 핸들러의 에러를 Sentry에 flush한다.
 * Cloud Functions의 짧은 수명주기에서 이벤트가 유실되지 않도록 보장.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
    if (!_sentry) return;
    await _sentry.flush(timeoutMs);
}
