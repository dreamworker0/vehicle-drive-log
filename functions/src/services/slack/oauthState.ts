/**
 * oauthState — Slack 설치 OAuth의 state 서명/검증 (순수 함수)
 *
 * state는 CSRF·변조·재생(replay)을 막는다:
 *  - HMAC-SHA256 서명(SLACK_STATE_SECRET)으로 무결성 보장 → organizationId를 서버가
 *    발급 시점에 바인딩하므로 콜백에서 사용자가 org를 조작할 수 없다.
 *  - iat(발급시각) + TTL로 신선도 보장.
 *  - nonce(1회성)는 별도 Firestore 문서(slackOauthStates)로 소비 처리한다(핸들러 담당).
 *
 * 이 모듈은 Firestore에 의존하지 않아 단위테스트가 쉽다.
 */
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

/** state 유효기간 (초) — 설치 흐름은 즉시 진행되므로 짧게 */
export const STATE_TTL_SEC = 600;
/** 시계 오차 허용(미래 방향) */
const CLOCK_SKEW_SEC = 60;

export interface OAuthStatePayload {
    organizationId: string;
    uid: string;
    nonce: string;
    /** 발급 시각(epoch seconds) */
    iat: number;
}

function b64url(buf: Buffer): string {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Buffer {
    return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** payload를 base64url(JSON).서명 형태의 state 문자열로 만든다 */
export function signState(payload: OAuthStatePayload, secret: string): string {
    const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
    const sig = b64url(createHmac("sha256", secret).update(body).digest());
    return `${body}.${sig}`;
}

/**
 * state 문자열을 검증한다. 서명 불일치·형식 오류·만료·미래시각이면 null.
 * @param nowSec 테스트 주입용 현재 시각(초)
 */
export function verifyState(state: string | undefined, secret: string, nowSec?: number): OAuthStatePayload | null {
    if (!state || typeof state !== "string") return null;
    const dot = state.indexOf(".");
    if (dot <= 0) return null;
    const body = state.slice(0, dot);
    const sig = state.slice(dot + 1);

    const expected = b64url(createHmac("sha256", secret).update(body).digest());
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    let payload: OAuthStatePayload;
    try {
        payload = JSON.parse(fromB64url(body).toString("utf8")) as OAuthStatePayload;
    } catch {
        return null;
    }
    if (!payload || !payload.organizationId || !payload.uid || !payload.nonce || typeof payload.iat !== "number") {
        return null;
    }
    const now = nowSec ?? Math.floor(Date.now() / 1000);
    if (now - payload.iat > STATE_TTL_SEC) return null; // 만료
    if (payload.iat - now > CLOCK_SKEW_SEC) return null; // 미래 발급(위조)
    return payload;
}

/** 1회성 nonce 생성 */
export function newNonce(): string {
    return randomUUID();
}
