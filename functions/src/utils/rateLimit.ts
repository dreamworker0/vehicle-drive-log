/**
 * rateLimit — Firestore 기반 Rate Limiting 유틸리티
 * 사용자(uid) 또는 IP별로 요청 횟수를 제한한다.
 */
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { log } from "../utils/helpers";

const RATE_LIMIT_COLLECTION = "_rateLimits";

/**
 * Firestore 장애 등으로 한도 확인 자체가 실패했을 때의 정책 (2026-07-10 코덱스 평가 대응 — 작업 2).
 * - "open"(기본): 요청 통과 — 일반 업무 API의 가용성 우선.
 * - "closed": 요청 거부 — OCR·AI·공개 접수처럼 남용 시 비용이 증폭되는 고위험 경로에만 지정.
 */
export type RateLimitFailMode = "open" | "closed";

/**
 * 시간 윈도우 키 생성 (분 단위 또는 시간 단위)
 */
function getWindowKey(windowSeconds: number): string {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    return String(windowStart);
}

/**
 * Rate Limit 검사 (onCall 함수용 — uid 기반)
 *
 * @param functionName 함수 이름 (예: "ocrDashboard")
 * @param uid 사용자 UID
 * @param maxRequests 윈도우 내 최대 요청 수
 * @param windowSeconds 시간 윈도우 (초)
 * @param failMode 한도 확인 실패 시 정책 (기본 "open" — 기존 호출부 동작 보존)
 * @throws HttpsError("resource-exhausted") 초과 시, failMode "closed"면 확인 실패 시에도
 */
export async function checkRateLimitByUid(
    functionName: string,
    uid: string,
    maxRequests: number,
    windowSeconds: number,
    failMode: RateLimitFailMode = "open"
): Promise<void> {
    const windowKey = getWindowKey(windowSeconds);
    const docId = `${functionName}:${uid}:${windowKey}`;

    const db = getFirestore();
    const ref = db.collection(RATE_LIMIT_COLLECTION).doc(docId);

    try {
        const result = await db.runTransaction(async (tx) => {
            const doc = await tx.get(ref);
            const currentCount = doc.exists ? (doc.data()?.count || 0) : 0;

            if (currentCount >= maxRequests) {
                return { exceeded: true, count: currentCount };
            }

            tx.set(ref, {
                count: FieldValue.increment(1),
                functionName,
                uid,
                expiresAt: new Date(Date.now() + windowSeconds * 1000),
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            return { exceeded: false, count: currentCount + 1 };
        });

        if (result.exceeded) {
            log("WARNING", functionName, "Rate limit exceeded", { uid, count: result.count, maxRequests, windowSeconds });
            throw new HttpsError(
                "resource-exhausted",
                `요청이 너무 많습니다. ${windowSeconds >= 3600 ? Math.floor(windowSeconds / 3600) + "시간" : Math.floor(windowSeconds / 60) + "분"} 후 다시 시도해주세요.`
            );
        }
    } catch (err) {
        // HttpsError는 그대로 재전파
        if (err instanceof HttpsError) throw err;
        // 고위험 경로(failMode "closed")는 한도 확인 불가 시 거부 — 장애를 틈탄 비용 증폭 차단
        if (failMode === "closed") {
            log("ERROR", functionName, "Rate limit check failed, rejecting request (fail-closed)", { uid, error: (err as Error).message });
            throw new HttpsError("resource-exhausted", "요청 한도를 확인할 수 없어 요청이 거부되었습니다. 잠시 후 다시 시도해주세요.");
        }
        // Firestore 접근 에러 등은 Rate Limit을 무시하고 통과 (장애 시 기능 차단 방지)
        log("WARNING", functionName, "Rate limit check failed, allowing request", { uid, error: (err as Error).message });
    }
}

/**
 * OCR 일일 누적 한도 검사 — 사용자·조직 단위 (ocr-cost-security §1.1).
 * 분 단위 제한과 별개로, 하루 종일 반복 호출하는 비용 증폭을 막는 방어선이다.
 * 기존 창 버킷 로직을 재사용한다: epoch 정렬 24시간 버킷(`_rateLimits`, TTL expiresAt).
 * ocrDashboard·ocrDocument가 공유하는 통합 카운터 (uid: `ocrDailyUser:{uid}`, org: `ocrDailyOrg:{orgId}`).
 */
export async function checkDailyOcrQuota(
    uid: string,
    orgId: string | undefined,
    userLimit: { max: number; windowSec: number },
    orgLimit: { max: number; windowSec: number },
): Promise<void> {
    try {
        // OCR 쿼터는 비용 방어선이므로 확인 실패 시에도 거부한다 (fail-closed)
        await checkRateLimitByUid("ocrDailyUser", uid, userLimit.max, userLimit.windowSec, "closed");
        if (orgId) {
            // 조직 카운터는 uid 자리에 orgId를 키로 사용한다 (동일 버킷 로직 재사용)
            await checkRateLimitByUid("ocrDailyOrg", orgId, orgLimit.max, orgLimit.windowSec, "closed");
        }
    } catch (err) {
        if (err instanceof HttpsError && err.code === "resource-exhausted") {
            throw new HttpsError("resource-exhausted", "일일 OCR 호출 한도를 초과했습니다. 내일 다시 시도해주세요.");
        }
        throw err;
    }
}

/**
 * Rate Limit 검사 (onRequest 함수용 — IP 기반)
 *
 * @param functionName 함수 이름 (예: "tmapProxy")
 * @param ip 클라이언트 IP
 * @param maxRequests 윈도우 내 최대 요청 수
 * @param windowSeconds 시간 윈도우 (초)
 * @param failMode 한도 확인 실패 시 정책 (기본 "open" — 기존 호출부 동작 보존)
 * @returns true면 초과(또는 failMode "closed"에서 확인 실패), false면 통과
 */
export async function checkRateLimitByIp(
    functionName: string,
    ip: string,
    maxRequests: number,
    windowSeconds: number,
    failMode: RateLimitFailMode = "open"
): Promise<boolean> {
    const windowKey = getWindowKey(windowSeconds);
    // IP에 포함된 특수문자(콜론, 점)를 안전한 문자로 치환
    const safeIp = ip.replace(/[.:]/g, "_");
    const docId = `${functionName}:${safeIp}:${windowKey}`;

    const db = getFirestore();
    const ref = db.collection(RATE_LIMIT_COLLECTION).doc(docId);

    try {
        const result = await db.runTransaction(async (tx) => {
            const doc = await tx.get(ref);
            const currentCount = doc.exists ? (doc.data()?.count || 0) : 0;

            if (currentCount >= maxRequests) {
                return true; // exceeded
            }

            tx.set(ref, {
                count: FieldValue.increment(1),
                functionName,
                ip: safeIp,
                expiresAt: new Date(Date.now() + windowSeconds * 1000),
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            return false; // not exceeded
        });

        if (result) {
            log("WARNING", functionName, "Rate limit exceeded (IP)", { ip: safeIp, maxRequests, windowSeconds });
        }
        return result;
    } catch (err) {
        // 고위험 경로(failMode "closed")는 한도 확인 불가 시 초과로 간주해 거부
        if (failMode === "closed") {
            log("ERROR", functionName, "Rate limit check failed (IP), rejecting request (fail-closed)", { ip: safeIp, error: (err as Error).message });
            return true;
        }
        // Firestore 에러 시 Rate Limit을 무시하고 통과
        log("WARNING", functionName, "Rate limit check failed (IP), allowing request", { ip: safeIp, error: (err as Error).message });
        return false;
    }
}

/**
 * 만료된 Rate Limit 문서 정리
 * (참고: 시스템 스케줄러에서 해제됨. `_rateLimits`는 GCP Firestore TTL 정책
 * (`expiresAt` 필드, 2026-07-04 설정 확인)으로 자동 정리되므로 상시 호출되지 않는다.)
 */
export async function cleanupExpiredRateLimits(): Promise<number> {
    const db = getFirestore();
    const now = new Date();

    const expired = await db.collection(RATE_LIMIT_COLLECTION)
        .where("expiresAt", "<", now)
        .limit(500)
        .get();

    if (expired.empty) return 0;

    const batch = db.batch();
    expired.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    log("INFO", "cleanupRateLimits", `Cleaned up ${expired.size} expired rate limit entries`);
    return expired.size;
}
