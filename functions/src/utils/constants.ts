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
    // 온디맨드 캘린더 동기화 — 호출 1건당 Google Calendar API 조회 + 예약 범위 쿼리가 돈다.
    // 30분 쿨다운이 클라이언트(useCalendarSync의 COOLDOWN_MS)에만 있어 우회 가능했다.
    // 차량 키로 그 쿨다운을 서버에 옮기고(§1.1의 이중 키), uid 키로 기관 차량을
    // 돌려가며 호출하는 것까지 막는다. 6은 클라이언트 재시도 3회를 삼키고도 남는 값이다.
    onDemandCalendarSync: { max: 6, windowSec: 1800 },        // uid당 30분당 6회
    onDemandCalendarSyncVehicle: { max: 6, windowSec: 1800 }, // 차량당 30분당 6회
    // 캘린더 연결 진단 — 임의 캘린더 ID의 접근 가능 여부를 되돌려 주는 경로라, 상한이 없으면
    // 후보 ID를 훑는 오라클이 된다(2026-08-23 감사 발견 1). 정상 진단은 몇 번으로 끝난다.
    testCalendarAccess: { max: 20, windowSec: 3600 },         // uid당 시간당 20회
    // 연동 캘린더 일괄 진단 — 한 번에 수십 개 캘린더를 훑으므로 반복 호출이 곧 Calendar
    // 쿼터 소모다. 쿼터가 마르면 운영 동기화가 403(rateLimitExceeded)을 맞고, 그 403은
    // isCalendarAuthError를 타고 **멀쩡한 차량의 failCount를 올린다** — 진단이 장애를
    // 만드는 경로다. 정상 운영은 조치 전후로 몇 번이면 끝난다.
    probeCalendarAccess: { max: 6, windowSec: 3600 },          // uid당 시간당 6회
    // 초대 코드 재발급 — 정상 사용은 기관당 몇 달에 한 번. 상한은 코드를 계속 돌려
    // 직원 가입을 방해하는 남용만 막으면 된다 (2026-09-02, Rules에서 클라이언트 쓰기를 닫고 서버로 이관).
    regenerateInviteCode: { max: 5, windowSec: 3600 },        // uid당 시간당 5회
} as const;

export type RateLimitKey = keyof typeof DEFAULT_RATE_LIMITS;

/**
 * === 전역 예산 (ocr-cost-security §1.4) ===
 *
 * 주체 키(IP·이메일·uid)로 나누지 않는 **단일 카운터**다. 비인증이거나 주체를 무한히
 * 회전시킬 수 있는 경로에서, 주체별 상한이 뚫려도 남는 마지막 비용 상한선이다.
 * 값은 곧 "그 경로가 낼 수 있는 시간당(또는 일일) 최대 청구액"이므로, 정상 사용량의
 * 10배 이상으로 넉넉히 잡되 무한대는 아니게 둔다. 전부 fail-closed.
 *
 * Remote Config로 조율하지 않는다 — 조율 경로 자체가 장애나면 상한이 사라지기 때문에,
 * 이 값만은 배포된 코드에 고정한다.
 */
export const GLOBAL_BUDGETS = {
    /** 기관 신청 접수 — 요청 1건당 Gemini 프리스크린 1회. 실사용은 하루 몇 건 수준이다. */
    submitOrgApplication: { max: 40, windowSec: 3600 },
    /** 랜딩 공개 문의 — 접수 자체는 싸지만 generateFeedbackDraft가 뒤따른다. */
    submitPublicFeedback: { max: 60, windowSec: 3600 },
    /** 의견 AI 초안(트리거) — 전 사용자 합산 일일 상한 */
    feedbackAiDraft: { max: 200, windowSec: 86400 },
    /** 의견 AI 초안 — 작성자 1인당 일일 상한 */
    feedbackAiDraftPerAuthor: { max: 20, windowSec: 86400 },
} as const;
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
