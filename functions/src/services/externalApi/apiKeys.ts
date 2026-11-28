/**
 * apiKeys — 기관이 외부 시스템(구글 앱스 스크립트 등)에서 쓰는 읽기 전용 API 키
 *
 * ## 왜 만들었나 (2026-11-28)
 *
 * 한 이용 기관의 시설·차량 담당자가 자체 앱스 스크립트에서 "차량별 누적 주행거리와 하이패스
 * 잔액만" 읽어 가고 싶다고 문의했다. 키가 없으면 스크립트에 앱 로그인 정보를 넣어 Firestore를
 * 직접 읽는 방법밖에 없는데, 그러면 관리자 계정이 통째로 새어 나갈 수 있다. 그래서 **읽기 전용,
 * 기관 단위, 언제든 폐기할 수 있는** 키를 따로 준다.
 *
 * ## 저장 규약
 *
 * - 원래 키 값은 **저장하지 않는다.** SHA-256 해시를 문서 ID로 쓰고, 발급할 때 한 번만 화면에
 *   보여 준다. DB가 통째로 새어도 키를 되살릴 수 없다. 키 자체가 32바이트 난수라 솔트 없는
 *   해시로 충분하다(사전 공격이 성립하지 않는다).
 * - 문서 ID가 해시라 조회는 문서 1건 읽기로 끝난다(쿼리·인덱스 불필요).
 * - 기관마다 키는 하나다. 새로 발급하면 이전 키는 지운다(교체 = 폐기 + 발급).
 * - 컬렉션은 Rules로 클라이언트 접근을 전부 막는다(서버 전용). 화면은 콜러블로만 상태를 본다.
 */
import { createHash, randomBytes } from "crypto";
import type { FieldValue, Timestamp } from "firebase-admin/firestore";

/** 서버 전용 컬렉션 — firestore.rules에서 read·write 모두 false */
export const API_KEYS_COLLECTION = "externalApiKeys";

/** 키 접두사 — 사람이 봤을 때 무슨 값인지 알아보게 하고, 형식 검사의 첫 관문으로 쓴다 */
export const API_KEY_PREFIX = "dlk_";

/** 32바이트 난수를 base64url로 쓰면 43자다 */
const API_KEY_PATTERN = /^dlk_[A-Za-z0-9_-]{43}$/;

export interface ApiKeyDoc {
    organizationId: string;
    /** 화면 표시용 끝 4자리 — 어느 키가 살아 있는지 알아보는 용도 */
    hint: string;
    createdByUid: string;
    createdAt: Timestamp | FieldValue;
    /** 마지막 사용 시각. 매 호출마다 쓰지 않고 1시간 간격으로만 갱신한다 */
    lastUsedAt?: Timestamp | FieldValue | null;
}

/** 새 키를 만든다. 반환값은 발급 직후 한 번만 화면에 보여 주고 저장하지 않는다 */
export function generateApiKey(): string {
    return API_KEY_PREFIX + randomBytes(32).toString("base64url");
}

/** 저장·조회에 쓰는 해시 (문서 ID) */
export function hashApiKey(key: string): string {
    return createHash("sha256").update(key, "utf8").digest("hex");
}

/** 형식이 맞는 키인지 — 맞지 않으면 DB를 읽지 않고 바로 거절한다 */
export function isWellFormedApiKey(value: unknown): value is string {
    return typeof value === "string" && API_KEY_PATTERN.test(value);
}

/** 화면 표시용 끝 4자리 */
export function apiKeyHint(key: string): string {
    return key.slice(-4);
}

/**
 * 요청 헤더에서 키를 꺼낸다. `Authorization: Bearer <키>`가 기본이고,
 * Bearer를 붙이기 어려운 도구를 위해 `X-API-Key: <키>`도 받는다.
 *
 * 쿼리 문자열(`?key=`)은 받지 않는다 — 주소에 실린 값은 접속 기록·브라우저 기록·
 * 공유 링크에 그대로 남는다.
 */
export function extractApiKey(headers: Record<string, unknown> | undefined): string | null {
    if (!headers) return null;
    const auth = headers["authorization"];
    if (typeof auth === "string") {
        const match = /^Bearer\s+(\S+)\s*$/i.exec(auth);
        if (match) return match[1];
    }
    const direct = headers["x-api-key"];
    if (typeof direct === "string" && direct.trim() !== "") return direct.trim();
    return null;
}
