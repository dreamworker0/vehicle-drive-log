/**
 * rateLimit — Firestore 기반 Rate Limiting 유틸리티
 * 사용자(uid) 또는 IP별로 요청 횟수를 제한한다.
 */
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { log } from "./helpers";

const RATE_LIMIT_COLLECTION = "_rateLimits";

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
 * @throws HttpsError("resource-exhausted") 초과 시
 */
export async function checkRateLimitByUid(
    functionName: string,
    uid: string,
    maxRequests: number,
    windowSeconds: number
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
        // Firestore 접근 에러 등은 Rate Limit을 무시하고 통과 (장애 시 기능 차단 방지)
        log("WARNING", functionName, "Rate limit check failed, allowing request", { uid, error: (err as Error).message });
    }
}

/**
 * Rate Limit 검사 (onRequest 함수용 — IP 기반)
 *
 * @param functionName 함수 이름 (예: "tmapProxy")
 * @param ip 클라이언트 IP
 * @param maxRequests 윈도우 내 최대 요청 수
 * @param windowSeconds 시간 윈도우 (초)
 * @returns true면 초과, false면 통과
 */
export async function checkRateLimitByIp(
    functionName: string,
    ip: string,
    maxRequests: number,
    windowSeconds: number
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
        // Firestore 에러 시 Rate Limit을 무시하고 통과
        log("WARNING", functionName, "Rate limit check failed (IP), allowing request", { ip: safeIp, error: (err as Error).message });
        return false;
    }
}

/**
 * 만료된 Rate Limit 문서 정리
 * (주의: 현재 시스템 스케줄러에서 해제되었습니다. 비용 최적화를 위해
 * GCP Firestore 콘솔에서 `expiresAt` 필드에 TTL 정책을 설정하여 수명주기를 자동 관리해야 합니다.)
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
