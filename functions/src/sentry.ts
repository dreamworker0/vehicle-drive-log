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

interface SentryLike {
    init(options: { dsn: string; environment: string; tracesSampleRate: number }): void;
    captureException(error: unknown, options?: { extra?: Record<string, unknown> }): void;
    captureMessage(message: string, options?: { level?: string; extra?: Record<string, unknown> }): void;
    flush(timeoutMs?: number): Promise<boolean>;
}

let _sentry: SentryLike | null = null;
let _sentryInitialized = false;

function getSentry(): SentryLike | null {
    if (_sentryInitialized) return _sentry;
    _sentryInitialized = true;
    
    if (DSN && !IS_TEST) {
        try {
            _sentry = require("@sentry/node");
            _sentry?.init({
                dsn: DSN,
                environment: "cloud-functions",
                tracesSampleRate: 0,
            });
        } catch {
            // @sentry/node 로드 실패 시 무시
        }
    }
    return _sentry;
}

import { sendDiscordAlert } from "./discord";

/**
 * Sentry에 에러를 전송한다.
 * DSN이 설정되지 않거나 테스트 환경이면 아무것도 하지 않는다.
 */
export function captureError(error: unknown, context: Record<string, unknown> = {}): void {
    const sentry = getSentry();
    if (!sentry) return;
    
    let errorMessage = "Unknown Error";

    if (error instanceof Error) {
        errorMessage = error.message;
        sentry.captureException(error, { extra: context });
    } else {
        errorMessage = String(error);
        sentry.captureMessage(errorMessage, {
            level: "error",
            extra: context,
        });
    }

    // 디스코드 웹훅 알림 병행 발송 (Fire-and-forget)
    sendDiscordAlert({
        title: "🚨 Cloud Functions Exception",
        description: `**Error:** ${errorMessage}\n\n**Context:**\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``.substring(0, 3999),
        color: 16711680, // Red
    }).catch(() => {});
}

/**
 * Sentry에 경고 메시지를 전송한다.
 */
export function captureWarning(message: string, context: Record<string, unknown> = {}): void {
    const sentry = getSentry();
    if (!sentry) return;
    sentry.captureMessage(message, {
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
