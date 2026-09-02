/**
 * probeCalendarAccess — 연동 캘린더 일괄 접근 진단 (슈퍼관리자 · 읽기 전용)
 *
 * ## 왜 필요한가 (2026-09-03 조사)
 *
 * `calendarSyncFailCount >= 10`인 차량은 스케줄러도 예약 트리거도 **호출 자체를 건너뛴다**
 * (calendarFailTracking.MAX_FAIL_COUNT). 쿼터를 아끼려는 의도적 설계지만, 부작용으로
 * **그 차량은 그 순간 이후 단 한 번도 테스트되지 않는다.** 그래서 조사 시점에 연동 차량
 * 161대 중 67대가 영구중단이었는데, 그중 30일 로그에 흔적이 남은 것은 10대뿐이었다 —
 * 나머지 57대는 5~8월에 얼어붙은 뒤 상태를 아무도 모른다. 기관이 그동안 공유를 고쳐
 * 놓았더라도 시스템은 영영 눈치채지 못한다.
 *
 * 그 공백을 메우는 도구다. **지금 이 캘린더가 살아 있는가**를 서비스 계정 신원으로 직접
 * 물어, 카운터만 되돌리면 될 차량과 기관이 재연동해야 할 차량을 가른다. 이 판별 없이
 * `resetCalendarSyncFails`를 누르면 죽은 캘린더까지 전부 재시도에 풀려 며칠에 걸쳐 도로
 * 10까지 올라간다 — 대시보드만 잠깐 초록이 되는 **거짓 회복**이다.
 *
 * ## 읽기 전용
 *
 * Firestore에도 캘린더에도 쓰지 않는다. 판별만 돌려주고, 무엇을 되돌릴지는 사람이 정한다.
 * 카운터 리셋은 별도 경로(`resetCalendarSyncFails`·관리자 화면의 연동 테스트)가 담당한다.
 *
 * ## 정찰 도구가 되지 않는 이유
 *
 * `testCalendarAccess`는 임의의 ID를 받기 때문에 후보를 훑는 오라클이 될 수 있어 시간당
 * 상한을 건다(2026-08-23 감사 발견 1). 이 함수는 **입력을 받지 않는다** — 우리 vehicles에
 * 이미 등록된 캘린더만 훑으므로 열거에 쓸 수 없다. 대신 슈퍼관리자로 제한한다.
 */
import { onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { normalizeCalendarId } from "../../services/calendar/calendarBinding";
import { MAX_FAIL_COUNT } from "../../services/calendar/calendarFailTracking";
import { log, requireSuperAdmin } from "../../utils/helpers";

const db = getFirestore();

/** 동시에 띄우는 캘린더 조회 수 — 타임아웃 안에 끝내면서 API를 몰아치지 않는 선. */
const CONCURRENCY = 5;

/**
 * 한 번에 진단할 고유 캘린더 상한. 지금은 60개 안팎이지만, 기관이 늘어 이 수를 넘기면
 * 타임아웃에 걸려 **결과를 통째로 잃는다.** 상한에서 자르고 잘랐다는 사실을 함께 돌려준다.
 */
const MAX_CALENDARS = 300;

/** 진단 결과 유형 */
export type ProbeVerdict =
    | "ok"                      // 접근 가능 — 공유가 살아 있다
    | "not_found"               // 404: 캘린더가 삭제됐거나 공유된 적이 없다
    | "forbidden"               // 403: 공유는 있으나 권한이 부족하다
    | "service_account_address" // 캘린더 ID 칸에 공유 대상 주소를 넣은 설정 오류
    | "malformed"               // `@`가 없는 값 (화면 URL 등)
    | "error";                  // 그 밖의 오류 (네트워크·쿼터 등)

export interface ProbeRow {
    calendarId: string;
    organizationId: string;
    organizationName: string;
    /** 기관 문서의 status. 문서가 없으면 "(문서없음)" — 고아 차량을 드러낸다. */
    organizationStatus: string;
    /** 기관의 googleCalendarEnabled. false면 애초에 동기화가 돌지 않는다. */
    calendarEnabled: boolean;
    vehicleCount: number;
    vehicleNames: string[];
    /** 이 캘린더를 쓰는 차량들의 최대 failCount */
    maxFailCount: number;
    verdict: ProbeVerdict;
    /** 원인 파악용 짧은 설명 (사용자 노출 문구가 아니다) */
    detail?: string;
}

/** googleapis 오류에서 HTTP 상태 코드를 뽑는다 — calendarFailTracking과 같은 기준. */
function statusOf(err: unknown): number {
    const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
    return Number(e?.response?.status ?? e?.status ?? e?.code);
}

/** 정해진 동시 실행 수로 작업을 흘려보낸다 (외부 의존 없이). */
async function runPooled<T>(tasks: Array<() => Promise<T>>, size: number): Promise<T[]> {
    const results = new Array<T>(tasks.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(size, tasks.length) }, async () => {
        for (;;) {
            const i = next++;
            if (i >= tasks.length) return;
            results[i] = await tasks[i]();
        }
    });
    await Promise.all(workers);
    return results;
}

interface ProbeRequest {
    /** true면 failCount가 낮은 정상 차량까지 전부 진단한다 (기본: 실패 누적분만). */
    includeHealthy?: boolean;
}

export const probeCalendarAccess = onCall<ProbeRequest>(
    {
        region: "asia-northeast3",
        // 캘린더 API를 수십 번 순회한다 — 진단이 통째로 날아가지 않게 넉넉히 잡는다.
        timeoutSeconds: 300,
        memory: "512MiB",
        // 슈퍼관리자 대시보드에서만 호출된다 — 같은 화면의 apiHealthCheck가 이미 강제하므로
        // 여기만 풀면 그 화면에서 가장 약한 문이 된다. 기관 관리자용 진단 도구
        // (testCalendarAccess)와 달리, 강제가 실패해도 기관이 연동 문제를 못 고치는 부작용이 없다.
        enforceAppCheck: true,
        cors: true,
    },
    async (request) => {
        requireSuperAdmin(request);

        const includeHealthy = request.data?.includeHealthy === true;

        log("INFO", "probeCalendarAccess", "캘린더 접근 진단 시작", {
            uid: request.auth.uid,
            includeHealthy,
        });

        // 1. 연동 차량을 고유 캘린더 단위로 묶는다. 한 기관이 모든 차량에 같은 캘린더를
        //    쓰는 경우가 많아, 차량마다 부르면 같은 캘린더를 대수만큼 다시 두드린다.
        const vehiclesSnap = await db.collection("vehicles").where("googleCalendarId", "!=", "").get();

        interface Group {
            calendarId: string;
            organizationId: string;
            vehicleNames: string[];
            maxFailCount: number;
        }
        const groups = new Map<string, Group>();

        for (const doc of vehiclesSnap.docs) {
            const v = doc.data();
            const raw = (v.googleCalendarId as string) || "";
            if (!raw.trim()) continue;

            const failCount = (v.calendarSyncFailCount as number) || 0;
            // 기본은 문제가 있는 차량만 본다 — 정상 차량까지 매번 두드릴 이유가 없다.
            if (!includeHealthy && failCount < 3) continue;

            const key = normalizeCalendarId(raw);
            const g = groups.get(key) ?? {
                calendarId: key,
                organizationId: (v.organizationId as string) || "",
                vehicleNames: [],
                maxFailCount: 0,
            };
            g.vehicleNames.push((v.displayName as string) || doc.id);
            g.maxFailCount = Math.max(g.maxFailCount, failCount);
            groups.set(key, g);
        }

        const all = [...groups.values()];
        const truncated = all.length > MAX_CALENDARS;
        const targets = truncated ? all.slice(0, MAX_CALENDARS) : all;

        // 2. 기관 문서는 캘린더마다가 아니라 기관마다 한 번만 읽는다.
        const orgCache = new Map<string, { name: string; status: string; enabled: boolean }>();
        for (const g of targets) {
            if (!g.organizationId || orgCache.has(g.organizationId)) continue;
            const snap = await db.collection("organizations").doc(g.organizationId).get();
            const d = snap.data();
            orgCache.set(g.organizationId, {
                name: (d?.name as string) || g.organizationId,
                // 기관 문서가 없는 차량이 실제로 있었다 — 헬스 체크는 이것도 실패로 센다.
                status: snap.exists ? ((d?.status as string) || "(상태없음)") : "(문서없음)",
                enabled: snap.exists && d?.googleCalendarEnabled !== false,
            });
        }

        // 3. 캘린더 접근 진단. googleapis는 콜드스타트 비용이 커서 여기서 불러온다
        //    (calendarSync.ts와 같은 이유).
        const { google } = await import("googleapis");
        const auth = new google.auth.GoogleAuth({
            scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
        });
        const calendar = google.calendar({ version: "v3", auth });
        const timeMin = new Date().toISOString();

        const rows = await runPooled<ProbeRow>(
            targets.map((g) => async (): Promise<ProbeRow> => {
                const org = orgCache.get(g.organizationId);
                const base: Omit<ProbeRow, "verdict" | "detail"> = {
                    calendarId: g.calendarId,
                    organizationId: g.organizationId,
                    organizationName: org?.name || "(기관 미상)",
                    organizationStatus: org?.status || "(문서없음)",
                    calendarEnabled: org?.enabled ?? false,
                    vehicleCount: g.vehicleNames.length,
                    vehicleNames: g.vehicleNames,
                    maxFailCount: g.maxFailCount,
                };

                // 캘린더 API를 부르기 전에 값 자체가 틀린 경우를 먼저 가른다 — 보낼 필요가
                // 없는 요청은 보내지 않는다(calendarBinding과 같은 순서).
                if (g.calendarId.endsWith(".gserviceaccount.com")) {
                    return { ...base, verdict: "service_account_address", detail: "공유 대상 서비스 계정 주소가 캘린더 ID 칸에 들어 있다" };
                }
                if (!g.calendarId.includes("@")) {
                    return { ...base, verdict: "malformed", detail: "캘린더 ID 형식이 아니다 (@ 없음)" };
                }

                try {
                    await calendar.events.list({
                        calendarId: g.calendarId,
                        timeMin,
                        maxResults: 1,
                        singleEvents: true,
                    });
                    return { ...base, verdict: "ok" };
                } catch (err: unknown) {
                    const status = statusOf(err);
                    const message = (err as Error)?.message || "알 수 없는 오류";
                    if (status === 404) return { ...base, verdict: "not_found", detail: message };
                    if (status === 403) return { ...base, verdict: "forbidden", detail: message };
                    return { ...base, verdict: "error", detail: `${status || "?"}: ${message}` };
                }
            }),
            CONCURRENCY,
        );

        // 4. 사람이 바로 행동할 수 있게 집계한다.
        const isBlocked = (r: ProbeRow) => r.maxFailCount >= MAX_FAIL_COUNT;
        // 살아 있는데 카운터에 막혀 있는 것 — 리셋만으로 복구되는 대상.
        const resettable = rows.filter((r) => r.verdict === "ok" && r.maxFailCount > 0);
        // 죽어 있는 것 — 기관이 공유를 다시 걸어야 한다.
        const needsOrgAction = rows.filter((r) => r.verdict !== "ok" && r.maxFailCount > 0);
        // 헬스 체크가 실패로 세지만 실제로는 동기화가 돌지 않는 것 — 오탐.
        const falsePositives = rows.filter(
            (r) => isBlocked(r) && (!r.calendarEnabled || r.organizationStatus !== "approved"),
        );

        const sumVehicles = (list: ProbeRow[]) => list.reduce((n, r) => n + r.vehicleCount, 0);

        const summary = {
            probedCalendars: rows.length,
            probedVehicles: sumVehicles(rows),
            okCalendars: rows.filter((r) => r.verdict === "ok").length,
            resettableCalendars: resettable.length,
            resettableVehicles: sumVehicles(resettable),
            needsOrgActionCalendars: needsOrgAction.length,
            needsOrgActionVehicles: sumVehicles(needsOrgAction),
            falsePositiveCalendars: falsePositives.length,
            falsePositiveVehicles: sumVehicles(falsePositives),
            truncated,
            totalCalendars: all.length,
        };

        log("INFO", "probeCalendarAccess", "캘린더 접근 진단 완료", summary);

        // 심각한 것부터 보이게 정렬한다 (막힌 차량 수 → 실패 횟수).
        const order: Record<ProbeVerdict, number> = {
            not_found: 0, forbidden: 1, service_account_address: 2, malformed: 3, error: 4, ok: 5,
        };
        rows.sort((a, b) =>
            order[a.verdict] - order[b.verdict] ||
            b.vehicleCount - a.vehicleCount ||
            a.organizationName.localeCompare(b.organizationName, "ko"),
        );

        return { summary, rows };
    },
);
