/**
 * oauthState.test.ts — OAuth state 서명/검증 (CSRF·변조·재생 방어)
 */
import { signState, verifyState, newNonce, STATE_TTL_SEC, type OAuthStatePayload } from "../services/slack/oauthState";

const SECRET = "state-signing-secret";
const NOW = 1_700_000_000;

function payload(overrides: Partial<OAuthStatePayload> = {}): OAuthStatePayload {
    return { organizationId: "org1", uid: "user1", nonce: "nonce-1", iat: NOW, ...overrides };
}

describe("oauthState", () => {
    it("서명→검증 왕복이 원 payload를 복원한다", () => {
        const state = signState(payload(), SECRET);
        const result = verifyState(state, SECRET, NOW);
        expect(result).toEqual(payload());
    });

    it("서명이 다른 시크릿이면 거부한다", () => {
        const state = signState(payload(), SECRET);
        expect(verifyState(state, "other-secret", NOW)).toBeNull();
    });

    it("body가 변조되면 거부한다", () => {
        const state = signState(payload(), SECRET);
        const [body, sig] = state.split(".");
        const tamperedBody = Buffer.from(JSON.stringify(payload({ organizationId: "EVIL" })), "utf8")
            .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        expect(verifyState(`${tamperedBody}.${sig}`, SECRET, NOW)).toBeNull();
        expect(body).not.toBe(tamperedBody);
    });

    it("만료된 state(TTL 초과)는 거부한다", () => {
        const state = signState(payload({ iat: NOW - STATE_TTL_SEC - 1 }), SECRET);
        expect(verifyState(state, SECRET, NOW)).toBeNull();
    });

    it("TTL 경계 내에서는 통과한다", () => {
        const state = signState(payload({ iat: NOW - STATE_TTL_SEC + 5 }), SECRET);
        expect(verifyState(state, SECRET, NOW)).not.toBeNull();
    });

    it("미래 시각(위조)으로 발급된 state는 거부한다", () => {
        const state = signState(payload({ iat: NOW + 3600 }), SECRET);
        expect(verifyState(state, SECRET, NOW)).toBeNull();
    });

    it("형식이 잘못되면(점 없음/빈값) 거부한다", () => {
        expect(verifyState("no-dot-here", SECRET, NOW)).toBeNull();
        expect(verifyState("", SECRET, NOW)).toBeNull();
        expect(verifyState(undefined, SECRET, NOW)).toBeNull();
    });

    it("필수 필드가 빠지면 거부한다", () => {
        const bad = signState({ organizationId: "", uid: "u", nonce: "n", iat: NOW } as OAuthStatePayload, SECRET);
        expect(verifyState(bad, SECRET, NOW)).toBeNull();
    });

    it("newNonce는 매번 다른 값을 생성한다", () => {
        expect(newNonce()).not.toBe(newNonce());
    });
});
