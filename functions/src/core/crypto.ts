/**
 * crypto — 애플리케이션 레벨 대칭키 암호화 (AES-256-GCM)
 *
 * Firestore에 크리덴셜(예: 기관별 Slack 봇 토큰)을 평문으로 두지 않기 위한 봉투.
 * 마스터 키는 Secret Manager(예: SLACK_TOKEN_ENC_KEY)에 base64로 보관하고,
 * DB에는 암호문/IV/인증태그만 저장한다 — DB 덤프만으로는 복호화 불가.
 *
 * AAD(추가 인증 데이터)로 문서 식별자(예: `slack_{teamId}`)를 바인딩해
 * 암호문을 다른 문서로 이식하는 것을 막는다.
 *
 * Cloud KMS 대신 이 방식을 택한 이유는 계획서 참고: 소규모 운영에서
 * 의존성 0 · 로컬 복호화(지연/쿼터 없음) · 기존 Secret Manager 표준 재사용.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** 현재 암호화 스킴 버전 — 향후 키 로테이션/알고리즘 교체 시 분기용 */
export const CRYPTO_SCHEME_VERSION = 1;

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM 권장 96-bit
const TAG_BYTES = 16; // GCM 인증 태그

export interface EncryptedRecord {
    /** 스킴 버전 */
    v: number;
    /** 암호문 (base64) */
    cipher: string;
    /** IV (base64, 12바이트) */
    iv: string;
    /** GCM 인증 태그 (base64, 16바이트) */
    authTag: string;
}

/** base64 마스터 키를 32바이트 Buffer로 디코드하고 길이를 검증한다 */
function decodeKey(keyB64: string): Buffer {
    if (!keyB64) {
        throw new Error("암호화 키가 비어 있습니다.");
    }
    const key = Buffer.from(keyB64, "base64");
    if (key.length !== KEY_BYTES) {
        throw new Error(`암호화 키 길이가 올바르지 않습니다 (기대 ${KEY_BYTES}바이트, 실제 ${key.length}바이트). base64로 인코딩된 32바이트 키여야 합니다.`);
    }
    return key;
}

/**
 * 평문을 AES-256-GCM으로 암호화한다.
 * @param plaintext 암호화할 문자열 (예: "xoxb-...")
 * @param keyB64 base64 인코딩된 32바이트 마스터 키
 * @param aad 추가 인증 데이터 — 암호문을 특정 컨텍스트에 바인딩 (예: "slack_T123")
 */
export function encryptSecret(plaintext: string, keyB64: string, aad: string): EncryptedRecord {
    const key = decodeKey(keyB64);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
        v: CRYPTO_SCHEME_VERSION,
        cipher: encrypted.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
    };
}

/**
 * encryptSecret로 만든 레코드를 복호화한다.
 * 키 불일치·암호문/태그 변조·AAD 불일치 시 예외를 던진다(GCM 인증 실패).
 * @param record 저장된 암호화 레코드
 * @param keyB64 base64 인코딩된 32바이트 마스터 키
 * @param aad 암호화 시 사용한 것과 동일한 AAD
 */
export function decryptSecret(record: EncryptedRecord, keyB64: string, aad: string): string {
    const key = decodeKey(keyB64);
    if (!record || typeof record.cipher !== "string" || typeof record.iv !== "string" || typeof record.authTag !== "string") {
        throw new Error("암호화 레코드 형식이 올바르지 않습니다.");
    }
    const iv = Buffer.from(record.iv, "base64");
    const authTag = Buffer.from(record.authTag, "base64");
    if (iv.length !== IV_BYTES) {
        throw new Error("IV 길이가 올바르지 않습니다.");
    }
    if (authTag.length !== TAG_BYTES) {
        throw new Error("인증 태그 길이가 올바르지 않습니다.");
    }
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(Buffer.from(record.cipher, "base64")), decipher.final()]);
    return decrypted.toString("utf8");
}
