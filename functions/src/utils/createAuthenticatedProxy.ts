/**
 * createAuthenticatedProxy — 인증된 HTTP 프록시 팩토리
 *
 * 모든 외부 API 프록시 함수의 공통 보일러플레이트를 제거한다.
 * 자동 처리: region, CORS, wrapHttps, Firebase Auth 인증, IP Rate Limit
 * Rate Limit 값은 Remote Config에서 실시간 조회 (fallback: 기본값)
 */
import type { Request, Response } from "firebase-functions/node_modules/@types/express";
import { onRequest } from "firebase-functions/v2/https";
import { wrapHttps, verifyAuthToken } from "../utils/helpers";
import { checkRateLimitByIp } from "../utils/rateLimit";
import { getRateLimits, type RateLimitKey } from "../utils/constants";

/** 인증 완료 후 실행되는 핸들러 (uid가 보장됨) */
type AuthenticatedHandler = (
    req: Request,
    res: Response,
    uid: string
) => Promise<void>;

const CORS_ORIGINS = [
    "https://vehicle-drive-log.web.app",
    "https://vehicle-drive-log.firebaseapp.com",
] as const;

/**
 * 인증된 HTTP 프록시 Cloud Function을 생성한다.
 *
 * @param name - 함수 이름 (Rate Limit 키와 동일해야 함)
 * @param handler - 비즈니스 로직 핸들러 (인증/Rate Limit 통과 후 실행)
 */
export function createAuthenticatedProxy(
    name: RateLimitKey,
    handler: AuthenticatedHandler
) {
    return onRequest(
        {
            region: "asia-northeast3",
            cors: [...CORS_ORIGINS] as any,
        },
        wrapHttps(name, async (req: Request, res: Response) => {
            // 1. Firebase Auth 인증 검증
            const uid = await verifyAuthToken(req);
            if (!uid) {
                res.status(401).json({ error: "인증이 필요합니다." });
                return;
            }

            // 2. IP 기반 Rate Limit (Remote Config에서 실시간 조회)
            const rateLimit = await getRateLimits(name);
            const clientIp =
                req.ip ||
                (req.headers["x-forwarded-for"] as string) ||
                "unknown";
            const exceeded = await checkRateLimitByIp(
                name,
                clientIp,
                rateLimit.max,
                rateLimit.windowSec
            );
            if (exceeded) {
                res.status(429).json({
                    error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
                });
                return;
            }

            // 3. 비즈니스 로직 실행
            await handler(req, res, uid);
        })
    );
}

