/**
 * verifySlackSignature — Slack 수신 요청의 v0 HMAC 서명 검증
 * https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * timestamp가 ±5분을 벗어나면 replay 공격으로 간주해 거부한다.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_SEC = 300;

export function verifySlackSignature(opts: {
    signingSecret: string;
    /** X-Slack-Request-Timestamp 헤더 */
    timestamp: string | undefined;
    /** X-Slack-Signature 헤더 (v0=...) */
    signature: string | undefined;
    rawBody: Buffer | string | undefined;
    /** 테스트 주입용 현재 시각 (초) */
    nowSec?: number;
}): boolean {
    const { signingSecret, timestamp, signature, rawBody } = opts;
    if (!signingSecret || !timestamp || !signature || rawBody === undefined) return false;

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;

    const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > MAX_SKEW_SEC) return false;

    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const expected = "v0=" + createHmac("sha256", signingSecret)
        .update(`v0:${timestamp}:${body}`)
        .digest("hex");

    const expectedBuf = Buffer.from(expected, "utf8");
    const actualBuf = Buffer.from(signature, "utf8");
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
}
