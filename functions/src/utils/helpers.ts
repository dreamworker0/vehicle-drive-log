/**
 * helpers — Cloud Functions 공통 유틸리티
 * 구조화 로깅, HTTP 에러 래퍼, Callable 에러 래퍼
 */
import type { Request, Response } from "firebase-functions/node_modules/@types/express";
import { getAuth } from "firebase-admin/auth";
import { HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { captureError, flushSentry } from "../core/sentry";
import { checkRateLimitByUid } from "../utils/rateLimit";
import { getRateLimits, type RateLimitKey } from "../utils/constants";

type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

/**
 * HTTP 요청에서 Firebase Auth ID 토큰을 검증
 * Authorization: Bearer <idToken> 헤더에서 토큰을 추출하여 검증한다.
 * @returns 검증된 사용자 UID, 실패 시 null
 */
export async function verifyAuthToken(req: Request): Promise<string | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return null;
    const idToken = authHeader.slice(7);
    try {
        const decoded = await getAuth().verifyIdToken(idToken);
        return decoded.uid;
    } catch {
        return null;
    }
}

/**
 * 구조화 로깅 — Cloud Logging에서 severity 기반 필터링 가능
 */
export function log(severity: Severity, functionName: string, message: string, extra: Record<string, unknown> = {}): void {
    const entry = {
        severity,
        function: functionName,
        message,
        timestamp: new Date().toISOString(),
        ...extra,
    };

    if (severity === "ERROR") {
        console.error(JSON.stringify(entry));
        captureError(new Error(message), { function: functionName, ...extra });
    } else if (severity === "WARNING") {
        console.warn(JSON.stringify(entry));
    } else if (severity === "DEBUG") {
        console.debug(JSON.stringify(entry));
    } else {
        console.log(JSON.stringify(entry));
    }
}

/**
 * onRequest 핸들러용 에러 래퍼
 * try-catch를 감싸서 일관된 에러 응답과 구조화 로깅 제공
 */
export function wrapHttps(functionName: string, handler: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response) => Promise<void> {
    return async (req: Request, res: Response) => {
        try {
            await handler(req, res);
        } catch (err: unknown) {
            const error = err as Error;
            log("ERROR", functionName, error.message, {
                stack: error.stack,
                method: req.method,
                path: req.path,
            });
            await flushSentry();
            if (!res.headersSent) {
                res.status(500).json({ error: `${functionName} 처리 중 오류가 발생했습니다.` });
            }
        }
    };
}

/**
 * onCall / onDocumentCreated 등 비-HTTP 핸들러용 에러 래퍼
 */
export function wrapHandler<T extends unknown[], R>(functionName: string, handler: (...args: T) => Promise<R>): (...args: T) => Promise<R> {
    return async (...args: T) => {
        try {
            return await handler(...args);
        } catch (err: unknown) {
            const error = err as Error;
            log("ERROR", functionName, error.message, { stack: error.stack });
            await flushSentry();
            throw err; // 호출자에게 에러 전파
        }
    };
}

/**
 * Callable 요청의 superAdmin 권한 가드.
 * 미인증이면 unauthenticated, superAdmin 커스텀 클레임이 없으면 permission-denied를 던진다.
 * 통과하면 request.auth가 non-null로 좁혀진다.
 */
export function requireSuperAdmin<T>(
    request: CallableRequest<T>,
): asserts request is CallableRequest<T> & { auth: NonNullable<CallableRequest["auth"]> } {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    if (request.auth.token.role !== "superAdmin") {
        throw new HttpsError("permission-denied", "시스템 관리자만 사용할 수 있습니다.");
    }
}

interface WrapCallableOptions {
    rateLimitKey?: RateLimitKey;
}

/**
 * 보안 및 Rate limit이 적용된 onCall 핸들러용 공통 래퍼
 */
export function wrapCallableHandler<T, R>(
    functionName: string,
    options: WrapCallableOptions,
    handler: (request: CallableRequest<T>) => Promise<R>
): (request: CallableRequest<T>) => Promise<R> {
    return async (request: CallableRequest<T>) => {
        try {
            // 1. 공통 인증 검증
            if (!request.auth) {
                throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
            }
            
            // 2. 옵션에 따른 Rate Limit 자동 적용
            if (options.rateLimitKey) {
                const limit = await getRateLimits(options.rateLimitKey);
                await checkRateLimitByUid(
                    functionName, 
                    request.auth.uid, 
                    limit.max, 
                    limit.windowSec
                );
            }
            
            // 3. 본 비즈니스 로직 실행
            return await handler(request);
        } catch (err: unknown) {
            if (err instanceof HttpsError) {
                if (err.code === "internal" || err.code === "unknown") {
                    log("ERROR", functionName, err.message, { stack: err.stack });
                    await flushSentry();
                }
                throw err;
            }
            
            const error = err as Error;
            log("ERROR", functionName, error.message, { stack: error.stack });
            await flushSentry();
            throw new HttpsError("internal", `${functionName} 처리 중 오류가 발생했습니다.`);
        }
    };
}

/**
 * LLM 프롬프트에 보간되는 사용자 입력 위생 처리 — 프롬프트 인젝션 방어.
 * 따옴표·백틱·백슬래시를 제거해 구분자 탈출을 막고, 개행·연속 공백을 압축한 뒤
 * 길이를 절단한다. 사용자 입력은 데이터로만 취급되어야 하며 지시문이 되어선 안 된다.
 */
export function sanitizePromptValue(value: unknown, maxLen = 60): string {
    if (typeof value !== "string") return "";
    return value
        .replace(/["'`\\]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLen);
}

/**
 * 스케줄러 heartbeat 기록 — _health/{schedulerName} 문서에 마지막 실행 시각 저장
 * 헬스 체크에서 이 값을 읽어 스케줄러가 정상 동작 중인지 판단한다.
 */
export async function recordHeartbeat(schedulerName: string): Promise<void> {
    try {
        const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
        const db = getFirestore();
        await db.collection("_health").doc(schedulerName).set({
            lastRun: FieldValue.serverTimestamp(),
            updatedAt: new Date().toISOString(),
        }, { merge: true });
    } catch (err) {
        // heartbeat 실패가 스케줄러 자체를 중단시키면 안 됨
        console.warn(`[Heartbeat] ${schedulerName} 기록 실패:`, (err as Error).message);
    }
}

