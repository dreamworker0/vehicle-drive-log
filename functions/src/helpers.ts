/**
 * helpers — Cloud Functions 공통 유틸리티
 * 구조화 로깅, HTTP 에러 래퍼, Callable 에러 래퍼
 */
import type { Request, Response } from "firebase-functions/node_modules/@types/express";
import { getAuth } from "firebase-admin/auth";
import { captureError, flushSentry } from "./sentry";
import { sendDiscordAlert } from "./discord";

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
        
        // Discord Webhook으로 심각한 에러 즉시 알림
        sendDiscordAlert({
            title: `🚨 Cloud Function Error: ${functionName}`,
            description: message,
            fields: Object.entries(extra)
                .map(([name, value]) => ({
                    name,
                    value: String(value).substring(0, 1024),
                }))
                .slice(0, 25), // Discord Embed 길이/필드 제한 방어
        }).catch((e) => console.error("[Discord] 발송 실패", e));
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
