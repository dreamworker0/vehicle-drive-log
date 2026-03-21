/**
 * helpers — Cloud Functions 공통 유틸리티
 * 구조화 로깅, HTTP 에러 래퍼, Callable 에러 래퍼
 */
import type { Request, Response } from "firebase-functions/node_modules/@types/express";
import { getAuth } from "firebase-admin/auth";
import { captureError, flushSentry } from "./sentry";

type Severity = "INFO" | "WARNING" | "ERROR";

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
