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

import { sendDiscordAlert } from "./discord";

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
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- 테스트/미설정 환경에서 Sentry 미로딩을 위한 지연 require
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

/**
 * Sentry에 에러를 전송한다.
 * DSN이 설정되지 않거나 테스트 환경이면 아무것도 하지 않는다.
 */
export function captureError(error: unknown, context: Record<string, unknown> = {}): void {
    // Discord는 Sentry와 독립된 알림 경로다. 과거 이 조건이 `DSN && !IS_TEST`였는데,
    // 그러면 SENTRY_DSN_FUNCTIONS가 비어 있을 때 DISCORD_WEBHOOK_URL을 정확히 넣어도
    // 알림이 한 건도 나가지 않고 "URL 누락" 경고조차 뜨지 않는다(URL은 있으니까).
    // 두 경로를 분리한다 — URL 미설정 방어는 sendDiscordAlert가 이미 한다.
    if (!IS_TEST) {
        const message = error instanceof Error ? error.message : String(error);
        sendDiscordAlert({
            title: "🚨 Cloud Functions Exception",
            description: `**Error:** ${message}\n\n**Context:**\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``.substring(0, 3999),
            color: 16711680,
        }).catch(() => {});
    }

    const sentry = getSentry();
    if (!sentry) return;
    
    if (error instanceof Error) {
        sentry.captureException(error, { extra: context });
    } else {
        sentry.captureMessage(String(error), {
            level: "error",
            extra: context,
        });
    }
}

/**
 * 경고를 Sentry와 Discord로 전송한다.
 *
 * captureError와 같은 두 경로를 쓰되 **색과 제목으로 심각도를 구분한다**. 예전에는 Sentry로만
 * 보냈는데, 이 서비스의 운영자가 실제로 보는 곳은 Discord라서 경고가 사실상 아무에게도 닿지
 * 않았다. 그렇다고 captureError로 올리면 장애가 아닌 것이 빨간 "Exception"으로 떠서, 진짜
 * 장애 알림의 신뢰도를 갉아먹는다 — 2026-08-15의 백업 오알림이 정확히 그 문제였다.
 *
 * 그래서 경고는 **경고로 보이게** 보낸다. 호출부는 "사람이 알아야 하지만 실패는 아닌 것"에만
 * 쓴다 — 매번 뜨는 상태 보고에 쓰면 이 채널도 같은 이유로 무뎌진다.
 */
export function captureWarning(message: string, context: Record<string, unknown> = {}): void {
    if (!IS_TEST) {
        sendDiscordAlert({
            title: "⚠️ Cloud Functions Warning",
            description: `**Warning:** ${message}\n\n**Context:**\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``.substring(0, 3999),
            color: 16753920, // 주황(0xFFA500) — 빨강(Exception)과 한눈에 구분된다
        }).catch(() => {});
    }

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
