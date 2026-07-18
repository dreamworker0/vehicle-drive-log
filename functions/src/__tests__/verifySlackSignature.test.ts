/**
 * verifySlackSignature.test.ts — Slack v0 HMAC 서명 검증
 */
import { createHmac } from "node:crypto";
import { verifySlackSignature } from "../services/slack/verifySlackSignature";

const SECRET = "test-signing-secret";

function sign(secret: string, timestamp: string, body: string): string {
    return "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");
}

describe("verifySlackSignature", () => {
    const nowSec = 1_800_000_000;
    const body = '{"type":"event_callback"}';
    const ts = String(nowSec);

    it("유효한 서명이면 true", () => {
        expect(verifySlackSignature({
            signingSecret: SECRET,
            timestamp: ts,
            signature: sign(SECRET, ts, body),
            rawBody: Buffer.from(body),
            nowSec,
        })).toBe(true);
    });

    it("위조된 서명이면 false", () => {
        expect(verifySlackSignature({
            signingSecret: SECRET,
            timestamp: ts,
            signature: sign("wrong-secret", ts, body),
            rawBody: Buffer.from(body),
            nowSec,
        })).toBe(false);
    });

    it("본문이 변조되면 false", () => {
        expect(verifySlackSignature({
            signingSecret: SECRET,
            timestamp: ts,
            signature: sign(SECRET, ts, body),
            rawBody: Buffer.from(body + "tampered"),
            nowSec,
        })).toBe(false);
    });

    it("timestamp가 5분을 초과해 오래됐으면 false (replay 방어)", () => {
        const oldTs = String(nowSec - 301);
        expect(verifySlackSignature({
            signingSecret: SECRET,
            timestamp: oldTs,
            signature: sign(SECRET, oldTs, body),
            rawBody: Buffer.from(body),
            nowSec,
        })).toBe(false);
    });

    it("timestamp가 5분 이내면 true", () => {
        const recentTs = String(nowSec - 299);
        expect(verifySlackSignature({
            signingSecret: SECRET,
            timestamp: recentTs,
            signature: sign(SECRET, recentTs, body),
            rawBody: Buffer.from(body),
            nowSec,
        })).toBe(true);
    });

    it("헤더나 rawBody가 없으면 false", () => {
        expect(verifySlackSignature({ signingSecret: SECRET, timestamp: undefined, signature: "v0=x", rawBody: body, nowSec })).toBe(false);
        expect(verifySlackSignature({ signingSecret: SECRET, timestamp: ts, signature: undefined, rawBody: body, nowSec })).toBe(false);
        expect(verifySlackSignature({ signingSecret: SECRET, timestamp: ts, signature: "v0=x", rawBody: undefined, nowSec })).toBe(false);
    });

    it("timestamp가 숫자가 아니면 false", () => {
        expect(verifySlackSignature({
            signingSecret: SECRET,
            timestamp: "not-a-number",
            signature: sign(SECRET, "not-a-number", body),
            rawBody: body,
            nowSec,
        })).toBe(false);
    });
});
