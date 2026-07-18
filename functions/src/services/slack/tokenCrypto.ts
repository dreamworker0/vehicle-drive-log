/**
 * tokenCrypto — Slack 봇 토큰 암호화 얇은 래퍼
 *
 * core/crypto의 범용 AES-256-GCM 봉투에 Slack 전용 컨텍스트를 묶는다:
 * - 마스터 키: SLACK_TOKEN_ENC_KEY (Secret Manager)
 * - AAD: `slack_{teamId}` — 암호문을 해당 워크스페이스 통합 문서에 바인딩
 *
 * 이 래퍼를 쓰는 함수는 정의 옵션에 secrets:[SLACK_TOKEN_ENC_KEY]를 선언해야 한다.
 */
import { encryptSecret, decryptSecret, type EncryptedRecord } from "../../core/crypto";
import { SLACK_TOKEN_ENC_KEY } from "../../core/params";

/** teamId를 AAD 문자열로 — integrations 문서 ID 규칙과 일치 */
function aadFor(teamId: string): string {
    return `slack_${teamId}`;
}

/** Slack 봇 토큰을 암호화한다 (teamId에 바인딩) */
export function encryptSlackToken(teamId: string, token: string): EncryptedRecord {
    return encryptSecret(token, SLACK_TOKEN_ENC_KEY.value(), aadFor(teamId));
}

/** 암호화된 Slack 봇 토큰을 복호화한다 (teamId 일치 필요) */
export function decryptSlackToken(teamId: string, record: EncryptedRecord): string {
    return decryptSecret(record, SLACK_TOKEN_ENC_KEY.value(), aadFor(teamId));
}
