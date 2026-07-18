/**
 * crypto.test.ts — AES-256-GCM 봉투 암호화 (core/crypto)
 * 키·AAD·태그 무결성이 복호화에 반영되는지 검증한다.
 */
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret, CRYPTO_SCHEME_VERSION, type EncryptedRecord } from "../core/crypto";

/** 32바이트 랜덤 키를 base64로 */
function makeKey(): string {
    return randomBytes(32).toString("base64");
}

const AAD = "slack_T12345";
const PLAINTEXT = "xoxb-1234567890-abcdefg";

describe("crypto (AES-256-GCM)", () => {
    it("암호화→복호화 왕복이 원문을 복원한다", () => {
        const key = makeKey();
        const rec = encryptSecret(PLAINTEXT, key, AAD);
        expect(rec.v).toBe(CRYPTO_SCHEME_VERSION);
        expect(rec.cipher).not.toContain(PLAINTEXT); // 평문이 그대로 남지 않음
        expect(decryptSecret(rec, key, AAD)).toBe(PLAINTEXT);
    });

    it("암호화마다 IV가 달라 동일 평문도 다른 암호문이 된다", () => {
        const key = makeKey();
        const a = encryptSecret(PLAINTEXT, key, AAD);
        const b = encryptSecret(PLAINTEXT, key, AAD);
        expect(a.iv).not.toBe(b.iv);
        expect(a.cipher).not.toBe(b.cipher);
    });

    it("다른 키로는 복호화가 실패한다", () => {
        const rec = encryptSecret(PLAINTEXT, makeKey(), AAD);
        expect(() => decryptSecret(rec, makeKey(), AAD)).toThrow();
    });

    it("다른 AAD(다른 teamId)로는 복호화가 실패한다", () => {
        const key = makeKey();
        const rec = encryptSecret(PLAINTEXT, key, AAD);
        expect(() => decryptSecret(rec, key, "slack_OTHER")).toThrow();
    });

    it("암호문이 변조되면 복호화가 실패한다", () => {
        const key = makeKey();
        const rec = encryptSecret(PLAINTEXT, key, AAD);
        const tampered: EncryptedRecord = { ...rec, cipher: Buffer.from("tampered").toString("base64") };
        expect(() => decryptSecret(tampered, key, AAD)).toThrow();
    });

    it("인증 태그가 변조되면 복호화가 실패한다", () => {
        const key = makeKey();
        const rec = encryptSecret(PLAINTEXT, key, AAD);
        const badTag = Buffer.from(rec.authTag, "base64");
        badTag[0] ^= 0xff; // 첫 바이트 뒤집기
        expect(() => decryptSecret({ ...rec, authTag: badTag.toString("base64") }, key, AAD)).toThrow();
    });

    it("키 길이가 32바이트가 아니면 거부한다", () => {
        const shortKey = randomBytes(16).toString("base64");
        expect(() => encryptSecret(PLAINTEXT, shortKey, AAD)).toThrow(/키 길이/);
    });

    it("빈 키는 거부한다", () => {
        expect(() => encryptSecret(PLAINTEXT, "", AAD)).toThrow();
    });
});
