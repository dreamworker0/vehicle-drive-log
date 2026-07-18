/**
 * verifySlackSignature — Slack 수신 요청의 v0 HMAC 서명 검증
 * https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * timestamp가 ±5분을 벗어나면 replay 공격으로 간주해 거부한다.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_SEC = 300;

/** 검증 실패 사유 — 진단 로그용 (secret 값 자체는 절대 노출하지 않는다) */
export type SignatureCheckReason =
    | "ok"
    | "missing-inputs"
    | "bad-timestamp"
    | "stale-timestamp"
    | "length-mismatch"
    | "value-mismatch";

export interface SignatureCheckResult {
    valid: boolean;
    reason: SignatureCheckReason;
    /** rawBody 길이(바이트) — 본문 수신 여부 진단용 */
    bodyLength: number;
}

export function checkSlackSignature(opts: {
    signingSecret: string;
    /** X-Slack-Request-Timestamp 헤더 */
    timestamp: string | undefined;
    /** X-Slack-Signature 헤더 (v0=...) */
    signature: string | undefined;
    rawBody: Buffer | string | undefined;
    /** 테스트 주입용 현재 시각 (초) */
    nowSec?: number;
}): SignatureCheckResult {
    const { signingSecret, timestamp, signature, rawBody } = opts;
    const bodyLength = rawBody === undefined ? -1 : (typeof rawBody === "string" ? Buffer.byteLength(rawBody) : rawBody.length);

    if (!signingSecret || !timestamp || !signature || rawBody === undefined) {
        return { valid: false, reason: "missing-inputs", bodyLength };
    }

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return { valid: false, reason: "bad-timestamp", bodyLength };

    const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > MAX_SKEW_SEC) return { valid: false, reason: "stale-timestamp", bodyLength };

    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const expected = "v0=" + createHmac("sha256", signingSecret)
        .update(`v0:${timestamp}:${body}`)
        .digest("hex");

    const expectedBuf = Buffer.from(expected, "utf8");
    const actualBuf = Buffer.from(signature, "utf8");
    if (expectedBuf.length !== actualBuf.length) return { valid: false, reason: "length-mismatch", bodyLength };
    if (!timingSafeEqual(expectedBuf, actualBuf)) return { valid: false, reason: "value-mismatch", bodyLength };
    return { valid: true, reason: "ok", bodyLength };
}

/** 하위 호환 — boolean만 필요한 곳에서 사용 */
export function verifySlackSignature(opts: Parameters<typeof checkSlackSignature>[0]): boolean {
    return checkSlackSignature(opts).valid;
}
