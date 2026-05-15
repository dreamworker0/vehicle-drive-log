/**
 * apiHealthCheck — 외부 API 헬스 체크 (슈퍼관리자 전용)
 *
 * 5개 외부 API에 가벼운 핑을 병렬로 보내 상태를 확인한다.
 * 대시보드에서 신호등(🟢/🟡/🔴)으로 시각화하기 위한 데이터를 반환한다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { log } from "./helpers";

const TMAP_API_KEY = defineString("TMAP_API_KEY");
const HOLIDAY_API_KEY = defineString("HOLIDAY_API_KEY");
const geminiApiKey = defineString("GEMINI_API_KEY");

/** 단일 API 핑 결과 */
interface ApiHealthResult {
    name: string;
    displayName: string;
    status: "ok" | "degraded" | "error";
    latencyMs: number;
    error?: string;
    checkedAt: string;
}

/** 지연 기준 (ms) */
const DEGRADED_THRESHOLD_MS = 3000;
const PING_TIMEOUT_MS = 5000;

/**
 * 응답 시간과 성공 여부로 status 판정
 */
function judgeStatus(ok: boolean, latencyMs: number): "ok" | "degraded" | "error" {
    if (!ok) return "error";
    if (latencyMs >= DEGRADED_THRESHOLD_MS) return "degraded";
    return "ok";
}

/**
 * 단일 API 핑 실행 래퍼
 */
async function pingApi(
    name: string,
    displayName: string,
    fn: () => Promise<void>
): Promise<ApiHealthResult> {
    const start = Date.now();
    try {
        await fn();
        const latencyMs = Date.now() - start;
        return {
            name,
            displayName,
            status: judgeStatus(true, latencyMs),
            latencyMs,
            checkedAt: new Date().toISOString(),
        };
    } catch (err: unknown) {
        const latencyMs = Date.now() - start;
        const errorMsg = (err as Error).message || "Unknown error";
        return {
            name,
            displayName,
            status: "error",
            latencyMs,
            error: errorMsg.substring(0, 200),
            checkedAt: new Date().toISOString(),
        };
    }
}

/** Tmap API 핑 — 가벼운 POI 검색 */
async function pingTmap(): Promise<void> {
    const apiKey = TMAP_API_KEY.value();
    if (!apiKey) throw new Error("TMAP_API_KEY 미설정");

    const url = `https://apis.openapi.sk.com/tmap/pois?version=1&format=json&searchKeyword=${encodeURIComponent("서울시청")}&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&count=1`;
    const response = await fetch(url, {
        headers: { appKey: apiKey },
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
}

/** Gemini API 핑 — models.list() 조회 (토큰 비용 없음) */
async function pingGemini(): Promise<void> {
    const apiKey = geminiApiKey.value();
    if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");

    // REST API로 모델 목록 조회 (SDK의 models.list()보다 가벼움)
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=1`,
        { signal: AbortSignal.timeout(PING_TIMEOUT_MS) }
    );

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
}

/** 공공데이터포털 API 핑 — 올해 공휴일 1건만 조회 */
async function pingHoliday(): Promise<void> {
    const apiKey = HOLIDAY_API_KEY.value();
    if (!apiKey) throw new Error("HOLIDAY_API_KEY 미설정");

    const year = new Date().getFullYear();
    const url =
        `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo` +
        `?serviceKey=${apiKey}&solYear=${year}&numOfRows=1&_type=json`;

    const response = await fetch(url, {
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    // JSON 파싱 가능 여부도 확인
    const text = await response.text();
    try {
        JSON.parse(text);
    } catch {
        throw new Error("JSON 파싱 실패 (XML 응답 등)");
    }
}

/** 알림톡 프록시(Cafe24) 핑 */
async function pingAlimtalk(): Promise<void> {
    const proxyUrl = process.env.ALIMTALK_PROXY_URL;
    if (!proxyUrl) throw new Error("ALIMTALK_PROXY_URL 미설정");

    const response = await fetch(proxyUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });

    // 405(Method Not Allowed)도 서버가 살아있다는 의미이므로 OK 처리
    if (!response.ok && response.status !== 405) {
        throw new Error(`HTTP ${response.status}`);
    }
}

const discordWebhookUrl = defineString("DISCORD_WEBHOOK_URL", { default: "" });

/** Discord Webhook 핑 */
async function pingDiscord(): Promise<void> {
    const webhookUrl = discordWebhookUrl.value();
    if (!webhookUrl) throw new Error("DISCORD_WEBHOOK_URL 미설정");

    const response = await fetch(webhookUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });

    // 405도 OK 처리
    if (!response.ok && response.status !== 405) {
        throw new Error(`HTTP ${response.status}`);
    }
}

/** Firestore 핑 — 간단한 문서 read/write 테스트 */
async function pingFirestore(): Promise<void> {
    const db = getFirestore();
    const ref = db.collection("_health").doc("ping");
    await ref.set({ lastPing: new Date().toISOString() }, { merge: true });
    await ref.get();
}

/** Calendar Sync 상태 체크 — 실패 차량 비율 확인 */
interface CalendarSyncStatus {
    totalLinked: number;
    failedCount: number;
    permanentlyDisabled: number;
    cooldownCount: number;
}

async function checkCalendarSyncStatus(): Promise<CalendarSyncStatus> {
    const db = getFirestore();

    // googleCalendarId가 있는 차량 조회
    const linkedSnap = await db.collection("vehicles")
        .where("googleCalendarId", "!=", "")
        .get();

    const totalLinked = linkedSnap.size;
    let failedCount = 0;
    let permanentlyDisabled = 0;
    let cooldownCount = 0;

    for (const doc of linkedSnap.docs) {
        const data = doc.data();
        const failCount = (data.calendarSyncFailCount as number) || 0;
        if (failCount >= 10) {
            permanentlyDisabled++;
            failedCount++;
        } else if (failCount >= 3) {
            cooldownCount++;
            failedCount++;
        }
    }

    return { totalLinked, failedCount, permanentlyDisabled, cooldownCount };
}

/** Firebase Auth 핑 — 사용자 1명 조회 */
async function pingAuth(): Promise<void> {
    const auth = getAuth();
    await auth.listUsers(1);
}

/** Cloud Storage 핑 — 버킷 메타데이터 조회 */
async function pingStorage(): Promise<void> {
    const bucket = getStorage().bucket();
    await bucket.getMetadata();
}

/** 스케줄러 heartbeat 상태 체크 */
interface SchedulerHealthResult {
    name: string;
    displayName: string;
    status: "ok" | "degraded" | "error";
    lastRun: string | null;
    expectedIntervalMs: number;
}

const SCHEDULER_CONFIG: { name: string; displayName: string; expectedIntervalMs: number }[] = [
    { name: "reservationReminder", displayName: "예약 알림", expectedIntervalMs: 30 * 60 * 1000 },        // 15분마다, 30분 여유
    { name: "computeDashboardStats", displayName: "대시보드 캐싱", expectedIntervalMs: 2 * 60 * 60 * 1000 },  // 1시간마다, 2시간 여유
    { name: "syncCalendarToApp", displayName: "캘린더 싱크", expectedIntervalMs: 4 * 60 * 60 * 1000 },      // 2시간마다, 4시간 여유
    { name: "syncHolidays", displayName: "공휴일 동기화", expectedIntervalMs: 32 * 24 * 60 * 60 * 1000 },    // 한달마다, 32일 여유
];

async function checkSchedulerHealth(): Promise<SchedulerHealthResult[]> {
    const db = getFirestore();
    const results: SchedulerHealthResult[] = [];

    for (const cfg of SCHEDULER_CONFIG) {
        try {
            const doc = await db.collection("_health").doc(cfg.name).get();
            const data = doc.data();
            const lastRun = data?.lastRun?.toDate?.() || data?.lastRun;

            if (!lastRun) {
                results.push({
                    ...cfg,
                    status: "degraded",
                    lastRun: null,
                });
                continue;
            }

            const elapsed = Date.now() - new Date(lastRun).getTime();
            results.push({
                ...cfg,
                status: elapsed > cfg.expectedIntervalMs ? "error" : "ok",
                lastRun: new Date(lastRun).toISOString(),
            });
        } catch {
            results.push({
                ...cfg,
                status: "error",
                lastRun: null,
            });
        }
    }

    return results;
}

export const apiHealthCheck = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 60,
        memory: "256MiB",
        enforceAppCheck: false,
        cors: true,
    },
    async (request) => {
        // 인증 확인
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        // 슈퍼관리자 권한 확인
        if (request.auth.token.role !== "superAdmin") {
            throw new HttpsError("permission-denied", "시스템 관리자만 사용할 수 있습니다.");
        }

        log("INFO", "apiHealthCheck", "헬스 체크 시작", { uid: request.auth.uid });

        // 5개 외부 API 병렬 핑
        const externalResults = await Promise.all([
            pingApi("tmap", "T맵", pingTmap),
            pingApi("gemini", "Gemini AI", pingGemini),
            pingApi("holiday", "공공데이터포털", pingHoliday),
            pingApi("alimtalk", "알림톡 (Cafe24)", pingAlimtalk),
            pingApi("discord", "Discord", pingDiscord),
        ]);

        // 내부 서비스 핑 (병렬)
        const [firestoreResult, authResult, storageResult] = await Promise.all([
            pingApi("firestore", "Firestore DB", pingFirestore),
            pingApi("auth", "Firebase Auth", pingAuth),
            pingApi("storage", "Cloud Storage", pingStorage),
        ]);

        // Calendar Sync 상태 (핑이 아니라 DB 조회)
        let calendarSyncResult: ApiHealthResult;
        try {
            const syncStatus = await checkCalendarSyncStatus();
            const failRatio = syncStatus.totalLinked > 0
                ? syncStatus.failedCount / syncStatus.totalLinked
                : 0;

            let status: "ok" | "degraded" | "error" = "ok";
            let statusDetail = `${syncStatus.totalLinked}대 연동 중`;

            if (syncStatus.permanentlyDisabled > 0) {
                status = "error";
                statusDetail = `${syncStatus.permanentlyDisabled}대 영구중단, ${syncStatus.cooldownCount}대 쿨다운`;
            } else if (failRatio > 0.3) {
                status = "degraded";
                statusDetail = `${syncStatus.failedCount}/${syncStatus.totalLinked}대 실패 중`;
            }

            calendarSyncResult = {
                name: "calendarSync",
                displayName: "캘린더 동기화",
                status,
                latencyMs: 0,
                error: status !== "ok" ? statusDetail : undefined,
                checkedAt: new Date().toISOString(),
            };
        } catch (err: unknown) {
            calendarSyncResult = {
                name: "calendarSync",
                displayName: "캘린더 동기화",
                status: "error",
                latencyMs: 0,
                error: (err as Error).message?.substring(0, 200),
                checkedAt: new Date().toISOString(),
            };
        }

        // 스케줄러 heartbeat 상태
        const schedulerResults: ApiHealthResult[] = [];
        try {
            const schedulerStatuses = await checkSchedulerHealth();
            for (const s of schedulerStatuses) {
                const elapsed = s.lastRun
                    ? Math.round((Date.now() - new Date(s.lastRun).getTime()) / 60000)
                    : null;
                schedulerResults.push({
                    name: s.name,
                    displayName: s.displayName,
                    status: s.status,
                    latencyMs: 0,
                    error: s.status !== "ok"
                        ? (elapsed !== null ? `${elapsed}분 전 마지막 실행` : "실행 기록 없음")
                        : undefined,
                    checkedAt: new Date().toISOString(),
                });
            }
        } catch {
            // 스케줄러 체크 실패 시 무시
        }

        const internalResults = [firestoreResult, authResult, storageResult, calendarSyncResult, ...schedulerResults];
        const allResults = [...externalResults, ...internalResults];

        const errorCount = allResults.filter(r => r.status === "error").length;
        const degradedCount = allResults.filter(r => r.status === "degraded").length;

        log("INFO", "apiHealthCheck", "헬스 체크 완료", {
            total: allResults.length,
            ok: allResults.length - errorCount - degradedCount,
            degraded: degradedCount,
            error: errorCount,
        });

        return {
            results: externalResults,
            internalResults,
        };
    }
);
