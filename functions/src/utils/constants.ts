/**
 * constants — Cloud Functions 공통 상수
 *
 * Rate Limit 값은 Firebase Remote Config에서 실시간으로 가져온다.
 * Remote Config 미설정/오류 시 DEFAULT_RATE_LIMITS를 fallback으로 사용.
 */
import { getRemoteConfig } from "firebase-admin/remote-config";
import { log } from "../utils/helpers";

// === Rate Limit 기본값 (Remote Config fallback) ===
export const DEFAULT_RATE_LIMITS = {
    tmapProxy: { max: 30, windowSec: 60 },         // IP당 분당 30회
    holidayProxy: { max: 10, windowSec: 3600 },     // IP당 시간당 10회
    ocrDashboard: { max: 5, windowSec: 60 },        // uid당 분당 5회
    ocrDocument: { max: 3, windowSec: 60 },          // uid당 분당 3회
    ocrDailyUser: { max: 20, windowSec: 86400 },     // OCR 통합(계기판+증빙) 사용자당 일일 누적 (ocr-cost-security §1.1)
    ocrDailyOrg: { max: 50, windowSec: 86400 },      // OCR 통합 조직당 일일 누적
    joinOrganization: { max: 5, windowSec: 3600 },   // uid당 시간당 5회
    sendApprovalEmail: { max: 10, windowSec: 3600 },  // uid당 시간당 10회
    askAI: { max: 5, windowSec: 60 },               // uid당 분당 5회
    slackAssistant: { max: 10, windowSec: 600 },    // Slack 사용자당 10분당 10회 (Gemini 비용 방어, fail-closed)
    slackAssistantDailyOrg: { max: 100, windowSec: 86400 }, // Slack 기관당 일일 누적
} as const;

export type RateLimitKey = keyof typeof DEFAULT_RATE_LIMITS;
type RateLimitConfig = { max: number; windowSec: number };

// === 인메모리 캐시 (5분 TTL) ===
let cachedLimits: Record<string, RateLimitConfig> | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Remote Config에서 Rate Limit 값을 가져온다.
 * 캐시 유효 시 캐시 반환, 만료 시 새로 fetch.
 * 실패 시 DEFAULT_RATE_LIMITS fallback.
 */
export async function getRateLimits(name: RateLimitKey): Promise<RateLimitConfig> {
    // 캐시 유효 → 즉시 반환
    if (cachedLimits && Date.now() < cacheExpiry) {
        return cachedLimits[name] || DEFAULT_RATE_LIMITS[name];
    }

    try {
        const rc = getRemoteConfig();
        const template = await rc.getServerTemplate();
        const config = template.evaluate();
        const raw = config.getString("rate_limits");

        if (raw) {
            const parsed = JSON.parse(raw) as Record<string, RateLimitConfig>;
            cachedLimits = parsed;
            cacheExpiry = Date.now() + CACHE_TTL_MS;
            return parsed[name] || DEFAULT_RATE_LIMITS[name];
        }
    } catch (err) {
        const errorMsg = (err as Error).message;
        // Remote Config 템플릿 미설정은 정상적인 fallback 경로 → DEBUG
        const level = errorMsg.includes("NOT_FOUND") ? "DEBUG" : "WARNING";
        log(level, "constants", "Remote Config fetch failed, using defaults", {
            error: errorMsg,
        });
    }

    // fallback
    return DEFAULT_RATE_LIMITS[name];
}

// === 하위 호환성: 동기 접근이 필요한 곳에서 사용 ===
export const RATE_LIMITS = DEFAULT_RATE_LIMITS;

// === 파일 크기 제한 ===
/** base64 인코딩 최대 크기 (원본 ~5MB → base64 ~6.67MB, 여유분 포함 7MB) */
export const MAX_BASE64_SIZE = 7 * 1024 * 1024;
