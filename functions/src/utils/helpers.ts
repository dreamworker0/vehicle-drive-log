/**
 * helpers — Cloud Functions 공통 유틸리티
 * 구조화 로깅, HTTP 에러 래퍼, Callable 에러 래퍼
 */
import type { Request, Response } from "firebase-functions/node_modules/@types/express";
import { getAuth } from "firebase-admin/auth";
import { HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { captureError, flushSentry } from "../core/sentry";
import { checkRateLimitByUid, type RateLimitFailMode } from "../utils/rateLimit";
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
 * 서버 장애로 취급할 HttpsError 코드.
 *
 * 나머지 코드(invalid-argument·failed-precondition·resource-exhausted·permission-denied 등)는
 * **핸들러가 의도적으로 던진 거부**다. 잘못된 입력이나 업무 규칙 위반을 신청자에게 알려주는
 * 정상 응답이지 장애가 아니다.
 */
const SERVER_FAILURE_CODES = new Set<string>(["internal", "unknown"]);

function isServerFailure(err: unknown): boolean {
    return !(err instanceof HttpsError) || SERVER_FAILURE_CODES.has(err.code);
}

/**
 * onCall / onDocumentCreated 등 비-HTTP 핸들러용 에러 래퍼
 *
 * 의도적으로 던진 HttpsError 거부는 ERROR로 올리지 않는다. 예전에는 전부 ERROR로 찍었는데,
 * `log("ERROR", ...)`가 곧 `captureError`라서 "영리 사업자등록증이라 접수할 수 없습니다" 같은
 * **정상 반려**가 Discord·Sentry에 빨간 "Cloud Functions Exception"으로 떴다(2026-08-26).
 * 이런 알림이 쌓이면 진짜 장애 알림이 묻힌다.
 * 거부는 WARNING으로 남겨 Cloud Logging에서는 그대로 추적되게 하되 알림은 보내지 않는다.
 * (wrapCallableHandler와 동일한 기준)
 */
export function wrapHandler<T extends unknown[], R>(functionName: string, handler: (...args: T) => Promise<R>): (...args: T) => Promise<R> {
    return async (...args: T) => {
        try {
            return await handler(...args);
        } catch (err: unknown) {
            const error = err as Error;
            if (!isServerFailure(err)) {
                log("WARNING", functionName, error.message, { code: (err as HttpsError).code });
                throw err; // 거부 사유를 그대로 호출자에게 전달
            }
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
    /** 한도 확인 실패 시 정책 — 고위험(OCR·AI) 경로만 "closed" 지정 (기본 "open") */
    rateLimitFailMode?: RateLimitFailMode;
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
                    limit.windowSec,
                    options.rateLimitFailMode
                );
            }
            
            // 3. 본 비즈니스 로직 실행
            return await handler(request);
        } catch (err: unknown) {
            if (err instanceof HttpsError) {
                if (isServerFailure(err)) {
                    log("ERROR", functionName, err.message, { stack: err.stack });
                    await flushSentry();
                } else {
                    log("WARNING", functionName, err.message, { code: err.code });
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
 * HTML 이스케이프 — 이메일/HTML 템플릿에 사용자 입력을 보간할 때 사용.
 * 사용자 제어 문자열이 앵커·태그로 해석되어(예: 관리자 이메일에 피싱 링크 주입) 렌더되는 것을 막는다.
 */
export function escapeHtml(value: unknown): string {
    if (value == null) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * 프롬프트 첨부 이미지로 허용하는 호스트.
 *
 * 이 앱이 첨부로 다루는 이미지는 **전부 자기 Firebase Storage에 올린 것**이다
 * (FeedbackForm·useDriveLogOcr가 uploadBytes 후 getDownloadURL로 받은 주소).
 * 그 밖의 주소를 가져올 이유가 없다.
 */
const ALLOWED_IMAGE_HOSTS = new Set([
    "firebasestorage.googleapis.com",
    "storage.googleapis.com",
]);

/**
 * 서버가 가져와도 되는 주소인가.
 *
 * 화이트리스트가 없으면 **클라이언트가 적어 넣은 임의 주소를 서버가 대신 요청**하게 된다
 * (`imageUrls`는 사용자가 만든 Firestore 문서의 필드다). 내부망·메타데이터·제3자 서버로
 * 향하는 SSRF 통로이자, URL당 5MB를 문서마다 내려받는 대역폭 증폭 통로였다
 * (2026-08-14 감사 발견 3).
 */
export function isAllowedPromptImageUrl(raw: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return false;
    }
    // http·file·gs 등은 전부 거절 — 정상 첨부는 항상 https다.
    if (parsed.protocol !== "https:") return false;
    if (ALLOWED_IMAGE_HOSTS.has(parsed.hostname)) return true;
    // 신규 기본 버킷 도메인 (예: my-app.firebasestorage.app)
    return parsed.hostname.endsWith(".firebasestorage.app");
}

/**
 * 프롬프트 첨부 이미지 다운로드 — Gemini 비용 증폭 방어(개수·크기 상한) + SSRF 차단.
 * 사용자가 대용량·다수 이미지 URL로 LLM 호출 비용을 폭증시키는 것을 막는다.
 * 개수는 maxImages로 절단하고, 개별 이미지가 maxBytes를 넘으면 건너뛴다.
 * 호스트가 허용 목록 밖이면 요청 자체를 보내지 않는다.
 */
export async function fetchPromptImages(
    imageUrls: unknown,
    opts: { logName: string; maxImages?: number; maxBytes?: number },
): Promise<Array<{ mimeType: string; data: string }>> {
    const maxImages = opts.maxImages ?? 3;
    const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
    const urls = Array.isArray(imageUrls) ? imageUrls.slice(0, maxImages) : [];
    const images: Array<{ mimeType: string; data: string }> = [];

    for (const url of urls) {
        if (typeof url !== "string") continue;
        if (!isAllowedPromptImageUrl(url)) {
            log("WARNING", opts.logName, "허용되지 않은 이미지 호스트 — 건너뜀", {
                // 주소 원문을 그대로 남기면 로그가 공격자 문자열의 저장소가 된다. 호스트만 남긴다.
                host: (() => { try { return new URL(url).hostname; } catch { return "(파싱 불가)"; } })(),
            });
            continue;
        }
        try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.byteLength > maxBytes) {
                log("WARNING", opts.logName, "이미지 크기 초과로 건너뜀", { bytes: buf.byteLength, maxBytes });
                continue;
            }
            images.push({
                data: buf.toString("base64"),
                mimeType: res.headers.get("content-type") || "image/jpeg",
            });
        } catch (err) {
            log("WARNING", opts.logName, "이미지 불러오기 실패", { error: (err as Error).message });
        }
    }
    return images;
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

