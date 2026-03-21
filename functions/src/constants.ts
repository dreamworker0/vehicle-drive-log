/**
 * constants — Cloud Functions 공통 상수
 *
 * Rate Limit, 크기 제한 등 운영 파라미터를 한 곳에서 관리한다.
 * 향후 Remote Config로 전환 시 이 파일만 수정하면 된다.
 */

// === Rate Limit (함수명: { max, windowSec }) ===
export const RATE_LIMITS = {
    tmapProxy: { max: 30, windowSec: 60 },         // IP당 분당 30회
    holidayProxy: { max: 10, windowSec: 3600 },     // IP당 시간당 10회
    ocrDashboard: { max: 5, windowSec: 60 },        // uid당 분당 5회
    ocrDocument: { max: 3, windowSec: 60 },          // uid당 분당 3회
    joinOrganization: { max: 5, windowSec: 3600 },   // uid당 시간당 5회
    sendApprovalEmail: { max: 10, windowSec: 3600 },  // uid당 시간당 10회
} as const;

// === 파일 크기 제한 ===
/** base64 인코딩 최대 크기 (원본 ~5MB → base64 ~6.67MB, 여유분 포함 7MB) */
export const MAX_BASE64_SIZE = 7 * 1024 * 1024;
