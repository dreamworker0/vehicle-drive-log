/**
 * probeCalendarAccess — 연동 캘린더 일괄 접근 진단 (슈퍼관리자 · 진단 대상 무변경)
 *
 * ## 왜 필요한가 (2026-09-03 조사)
 *
 * `calendarSyncFailCount >= 10`인 차량은 스케줄러도 예약 트리거도 **호출 자체를 건너뛴다**
 * (calendarFailTracking.MAX_FAIL_COUNT). 쿼터를 아끼려는 의도적 설계지만, 부작용으로
 * **그 차량은 그 순간 이후 단 한 번도 테스트되지 않는다.** 그래서 조사 시점에 연동 차량
 * 161대 중 67대가 영구중단이었는데, 30일 로그에 흔적이 남은 것은 10대뿐이었다 —
 * 나머지 57대는 5~8월에 얼어붙은 뒤 상태를 아무도 모른다. 기관이 그동안 공유를 고쳐
 * 놓았더라도 시스템은 영영 눈치채지 못한다.
 *
 * 그 공백을 메우는 도구다. **지금 이 캘린더로 동기화가 도는가**를 판별해, 카운터만
 * 되돌리면 될 차량과 기관이 재연동해야 할 차량을 가른다. 이 판별 없이
 * `resetCalendarSyncFails`를 누르면 죽은 캘린더까지 전부 재시도에 풀려 며칠에 걸쳐 도로
 * 10까지 올라간다 — 대시보드만 잠깐 초록이 되는 **거짓 회복**이다.
 *
 * ## 운영 경로와 같은 순서로 판정한다
 *
 * 실제 동기화는 캘린더 API를 부르기 **전에** 기관 바인딩을 본다(calendarSchedule ·
 * reservationTriggers → `isCalendarBoundToOrg`). 그 게이트를 빼고 서비스 계정 신원으로만
 * 물으면, **다른 기관에 귀속된 캘린더가 "접근 가능"으로 나오지만 리셋해도 동기화는 영영
 * 건너뛴다** — 이 파일이 막으려는 거짓 회복이 그대로 재발한다. 그래서 여기서도 같은 순서로
 * 본다: 값 형식 → 바인딩 소유자 → 캘린더 접근.
 *
 * 바인딩은 **선점하지 않는 `getCalendarBindingOwner`로 읽기만 한다.** 진단이 선점까지
 * 해버리면 아직 동기화를 돌리지 않은 기관의 캘린더를 버튼 한 번으로 남이 가져간다
 * (calendarBinding.ts에 그 이유가 적혀 있다).
 *
 * ## 무엇을 쓰지 않는가
 *
 * 진단 대상(`vehicles` · `organizations` · `calendarBindings`)과 구글 캘린더에는 **쓰지
 * 않는다.** 무엇을 되돌릴지는 사람이 정한다. 유일한 쓰기는 남용 방지용 rate-limit 카운터다.
 *
 * ## 정찰 도구가 되지 않는 이유
 *
 * `testCalendarAccess`는 임의의 ID를 받기 때문에 후보를 훑는 오라클이 될 수 있다
 * (2026-08-23 감사 발견 1). 이 함수는 **캘린더 ID를 입력받지 않는다** — 우리 vehicles에
 * 이미 등록된 것만 훑으므로 열거에 쓸 수 없다. 상한은 열거가 아니라 **쿼터**를 막기 위한
 * 것이다(constants.probeCalendarAccess 주석 참고).
 */
import { onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { normalizeCalendarId, getCalendarBindingOwner } from "../../services/calendar/calendarBinding";
import { MAX_FAIL_COUNT, calendarErrorStatus } from "../../services/calendar/calendarFailTracking";
import { checkRateLimitByUid } from "../../utils/rateLimit";
import { getRateLimits } from "../../utils/constants";
import { log, requireSuperAdmin } from "../../utils/helpers";

const db = getFirestore();

/** 동시에 띄우는 외부/문서 조회 수 — 타임아웃 안에 끝내면서 API를 몰아치지 않는 선. */
const CONCURRENCY = 5;

/**
 * 한 번에 진단할 (기관 × 캘린더) 조합 상한. 지금은 30개 안팎이지만, 넘기면 타임아웃에 걸려
 * **결과를 통째로 잃는다.** 심각한 것부터 남기고 자른 뒤, 잘랐다는 사실을 함께 돌려준다.
 */
const MAX_TARGETS = 300;

/** 기관 문서가 없는 차량을 드러내는 표식 — 화면과 집계가 같은 문자열을 본다. */
const ORG_MISSING = "(문서없음)";

/** 진단 결과 유형 */
export type ProbeVerdict =
    | "ok"                      // 접근 가능 — 공유가 살아 있다
    | "not_found"               // 404: 캘린더가 삭제됐거나 공유된 적이 없다
    | "forbidden"               // 403: 공유는 있으나 권한이 부족하다
    | "rate_limited"            // 403이지만 사유가 쿼터·유량 — 캘린더 상태를 알 수 없다
    | "bound_to_other_org"      // 다른 기관에 귀속된 ID — 접근되더라도 동기화는 건너뛴다
    | "service_account_address" // 캘린더 ID 칸에 공유 대상 주소를 넣은 설정 오류
    | "malformed"               // `@`가 없는 값 (화면 URL 등)
    | "error";                  // 그 밖의 오류 (네트워크 등)

export interface ProbeRow {
    calendarId: string;
    organizationId: string;
    organizationName: string;
    /** 기관 문서의 status. 문서가 없으면 ORG_MISSING — 고아 차량을 드러낸다. */
    organizationStatus: string;
    /** 기관의 googleCalendarEnabled. false면 애초에 동기화가 돌지 않는다. */
    calendarEnabled: boolean;
    vehicleCount: number;
    /** 그중 영구중단(failCount >= MAX)인 차량 수 — 조치 규모는 이 수로 센다. */
    blockedVehicleCount: number;
    vehicleNames: string[];
    /** 이 기관에서 이 캘린더를 쓰는 차량들의 최대 failCount */
    maxFailCount: number;
    verdict: ProbeVerdict;
    /** 원인 파악용 짧은 설명 (사용자 노출 문구가 아니다) */
    detail?: string;
}

/** 403 중 "권한 없음"이 아니라 "지금은 못 물어본다"인 사유들 */
const RATE_LIMIT_REASONS = ["ratelimitexceeded", "userratelimitexceeded", "quotaexceeded"];

/**
 * 403이 유량 제한인지 판별한다. Google Calendar API는 쿼터 초과도 **403**으로 돌려주므로,
 * 가르지 않으면 살아 있는 캘린더가 "기관이 다시 공유해야 함"으로 표시돼 **기관에 헛수고를
 * 시킨다.**
 */
function isRateLimited(err: unknown): boolean {
    const e = err as {
        errors?: Array<{ reason?: string }>;
        response?: { data?: { error?: { errors?: Array<{ reason?: string }> } } };
    } | null;
    const reasons = [
        ...(e?.errors ?? []),
        ...(e?.response?.data?.error?.errors ?? []),
    ].map((x) => (x?.reason || "").toLowerCase());
    if (reasons.some((r) => RATE_LIMIT_REASONS.includes(r))) return true;
    const msg = ((err as Error)?.message || "").toLowerCase();
    return RATE_LIMIT_REASONS.some((r) => msg.includes(r)) || msg.includes("quota exceeded");
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

/** 기관 × 캘린더 조합 — 같은 문자열을 여러 기관이 쓰는 경우가 실재해 기관까지 키에 넣는다. */
interface Target {
    calendarId: string;
    organizationId: string;
    vehicleNames: string[];
    maxFailCount: number;
    blockedVehicleCount: number;
}

export const probeCalendarAccess = onCall<ProbeRequest>(
    {
        region: "asia-northeast3",
        // 캘린더 API를 수십 번 순회한다 — 진단이 통째로 날아가지 않게 넉넉히 잡는다.
        // **클라이언트도 같은 값을 줘야 한다** — httpsCallable 기본 타임아웃은 70초라,
        // 호출부가 옵션을 빼면 서버만 계속 돌고 결과는 버려진다(DashboardCalendarProbe).
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

        // 반복 호출이 곧 Calendar 쿼터 소모이고, 쿼터가 마르면 운영 동기화가 403을 맞아
        // 멀쩡한 차량의 failCount가 오른다 — 진단이 장애를 만드는 경로를 여기서 막는다.
        const limit = await getRateLimits("probeCalendarAccess");
        await checkRateLimitByUid("probeCalendarAccess", request.auth.uid, limit.max, limit.windowSec);

        log("INFO", "probeCalendarAccess", "캘린더 접근 진단 시작", {
            uid: request.auth.uid,
            includeHealthy,
        });

        // 1. 연동 차량을 (기관 × 캘린더) 단위로 묶는다.
        //
        //    캘린더 ID만으로 묶으면 **같은 문자열을 쓰는 다른 기관이 한 행에 뭉쳐 사라진다** —
        //    가설이 아니라 실측이다(2026-08-23 시딩에서 3개 기관·차량 8대가 같은 서비스 계정
        //    주소를 가리켰다). 운영자는 연락해야 할 기관을 놓치고 차량 수도 남의 것을 얹어 센다.
        //    캘린더 API 호출만 정규화 ID로 dedupe해 쿼터 절약은 그대로 지킨다.
        const vehiclesSnap = await db.collection("vehicles").where("googleCalendarId", "!=", "").get();

        const targets = new Map<string, Target>();
        for (const doc of vehiclesSnap.docs) {
            const v = doc.data();
            const raw = (v.googleCalendarId as string) || "";
            if (!raw.trim()) continue;

            const failCount = (v.calendarSyncFailCount as number) || 0;
            // 기본은 문제가 있는 차량만 본다 — 정상 차량까지 매번 두드릴 이유가 없다.
            if (!includeHealthy && failCount < 3) continue;

            const calendarId = normalizeCalendarId(raw);
            const organizationId = (v.organizationId as string) || "";
            const key = `${organizationId}::${calendarId}`;

            const t = targets.get(key) ?? {
                calendarId,
                organizationId,
                vehicleNames: [],
                maxFailCount: 0,
                blockedVehicleCount: 0,
            };
            t.vehicleNames.push((v.displayName as string) || doc.id);
            t.maxFailCount = Math.max(t.maxFailCount, failCount);
            if (failCount >= MAX_FAIL_COUNT) t.blockedVehicleCount++;
            targets.set(key, t);
        }

        // 상한은 **정렬한 뒤** 자른다. 상한을 넘는 상황이야말로 심각한 것부터 봐야 하는
        // 상황인데, 문서 순서대로 자르면 무엇이 잘릴지가 무작위가 된다.
        const allTargets = [...targets.values()].sort(
            (a, b) => b.maxFailCount - a.maxFailCount || b.vehicleNames.length - a.vehicleNames.length,
        );
        const truncated = allTargets.length > MAX_TARGETS;
        const scoped = truncated ? allTargets.slice(0, MAX_TARGETS) : allTargets;

        // 2. 기관 문서는 한 번에 읽는다 — 순차 왕복은 타임아웃 여유를 갉아먹는다.
        const orgIds = [...new Set(scoped.map((t) => t.organizationId).filter(Boolean))];
        const orgCache = new Map<string, { name: string; status: string; enabled: boolean }>();
        if (orgIds.length > 0) {
            const snaps = await db.getAll(...orgIds.map((id) => db.collection("organizations").doc(id)));
            for (const snap of snaps) {
                const d = snap.data();
                orgCache.set(snap.id, {
                    name: (d?.name as string) || snap.id,
                    // 기관 문서가 없는 차량이 실제로 있었다 — 헬스 체크는 이것도 실패로 센다.
                    status: snap.exists ? ((d?.status as string) || "(상태없음)") : ORG_MISSING,
                    enabled: snap.exists && d?.googleCalendarEnabled !== false,
                });
            }
        }

        // 3. 값 형식이 틀린 것을 먼저 가른다 — 보낼 필요가 없는 요청은 보내지 않는다
        //    (calendarBinding과 같은 순서).
        const preVerdict = new Map<string, { verdict: ProbeVerdict; detail: string }>();
        for (const t of scoped) {
            const key = `${t.organizationId}::${t.calendarId}`;
            if (t.calendarId.endsWith(".gserviceaccount.com")) {
                preVerdict.set(key, { verdict: "service_account_address", detail: "공유 대상 서비스 계정 주소가 캘린더 ID 칸에 들어 있다" });
            } else if (!t.calendarId.includes("@")) {
                preVerdict.set(key, { verdict: "malformed", detail: "캘린더 ID 형식이 아니다 (@ 없음)" });
            }
        }

        // 4. 바인딩 소유자를 읽는다(선점하지 않는다). 운영 경로가 캘린더 API 앞에서 보는
        //    게이트이므로, 여기서도 API보다 먼저 본다.
        const bindingTargets = scoped.filter((t) => !preVerdict.has(`${t.organizationId}::${t.calendarId}`));
        const uniqueForBinding = [...new Set(bindingTargets.map((t) => t.calendarId))];
        const owners = new Map<string, string | null>();
        const ownerResults = await runPooled(
            uniqueForBinding.map((id) => () => getCalendarBindingOwner(id)),
            CONCURRENCY,
        );
        uniqueForBinding.forEach((id, i) => owners.set(id, ownerResults[i]));

        // 5. 남은 것만 캘린더에 물어본다. 판정은 캘린더 ID 기준이라(서비스 계정 신원으로
        //    묻는다) 여러 기관이 같은 ID를 써도 한 번만 호출하고 결과를 공유한다.
        const needsApi = [...new Set(
            bindingTargets
                .filter((t) => {
                    const owner = owners.get(t.calendarId);
                    return !owner || owner === t.organizationId;
                })
                .map((t) => t.calendarId),
        )];

        const apiResult = new Map<string, { verdict: ProbeVerdict; detail?: string }>();
        if (needsApi.length > 0) {
            // googleapis는 콜드스타트 비용이 커서 여기서 불러온다 (calendarSync.ts와 같은 이유).
            const { google } = await import("googleapis");
            const auth = new google.auth.GoogleAuth({
                scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
            });
            const calendar = google.calendar({ version: "v3", auth });
            const timeMin = new Date().toISOString();

            const results = await runPooled<{ verdict: ProbeVerdict; detail?: string }>(
                needsApi.map((calendarId) => async () => {
                    try {
                        await calendar.events.list({ calendarId, timeMin, maxResults: 1, singleEvents: true });
                        return { verdict: "ok" as ProbeVerdict };
                    } catch (err: unknown) {
                        const message = (err as Error)?.message || "알 수 없는 오류";
                        // 쿼터·유량 403을 "권한 없음"으로 읽으면 기관에 헛수고를 시킨다.
                        if (isRateLimited(err)) {
                            return { verdict: "rate_limited" as ProbeVerdict, detail: message };
                        }
                        // 상태 추출은 운영 경로(isCalendarAuthError)와 같은 원본을 쓴다 —
                        // 숫자 없이 사유 문구만 오는 형태까지 같은 기준으로 흡수한다.
                        const status = calendarErrorStatus(err);
                        if (status === 404) return { verdict: "not_found" as ProbeVerdict, detail: message };
                        if (status === 403) return { verdict: "forbidden" as ProbeVerdict, detail: message };
                        return { verdict: "error" as ProbeVerdict, detail: `${status ?? "?"}: ${message}` };
                    }
                }),
                CONCURRENCY,
            );
            needsApi.forEach((id, i) => apiResult.set(id, results[i]));
        }

        // 6. 행 조립
        const rows: ProbeRow[] = scoped.map((t) => {
            const org = orgCache.get(t.organizationId);
            const key = `${t.organizationId}::${t.calendarId}`;
            const pre = preVerdict.get(key);
            const owner = owners.get(t.calendarId);

            let verdict: ProbeVerdict;
            let detail: string | undefined;
            if (pre) {
                verdict = pre.verdict;
                detail = pre.detail;
            } else if (owner && owner !== t.organizationId) {
                // 접근이 되더라도 운영 경로는 여기서 끊는다 — 리셋해도 복구되지 않는다.
                verdict = "bound_to_other_org";
                detail = "이 캘린더는 다른 기관에 귀속돼 있어, 카운터를 되돌려도 동기화가 건너뛴다";
            } else {
                const api = apiResult.get(t.calendarId);
                verdict = api?.verdict ?? "error";
                detail = api?.detail ?? (api ? undefined : "진단이 수행되지 않았다");
            }

            return {
                calendarId: t.calendarId,
                organizationId: t.organizationId,
                organizationName: org?.name || "(기관 미상)",
                organizationStatus: org?.status || ORG_MISSING,
                calendarEnabled: org?.enabled ?? false,
                vehicleCount: t.vehicleNames.length,
                blockedVehicleCount: t.blockedVehicleCount,
                vehicleNames: t.vehicleNames,
                maxFailCount: t.maxFailCount,
                verdict,
                detail,
            };
        });

        // 7. 사람이 바로 행동할 수 있게 집계한다. **세 갈래는 배타적이어야 한다** —
        //    화면이 나란한 카드로 보여주므로, 겹치면 합계가 대상 수를 넘어 운영자가
        //    규모를 과대평가한다.
        //
        //    오탐 기준은 **동기화 경로에 실제로 있는 게이트만** 본다. 기관 status는
        //    calendarSchedule·reservationTriggers 어디에서도 게이트가 아니다 —
        //    'pending'을 조치 불필요로 접으면 진짜 고장이 화면에서 지워진다.
        const isInert = (r: ProbeRow) => !r.calendarEnabled || r.organizationStatus === ORG_MISSING;
        const blocked = rows.filter((r) => r.blockedVehicleCount > 0);

        const falsePositives = blocked.filter(isInert);
        const actionable = blocked.filter((r) => !isInert(r));
        const resettable = actionable.filter((r) => r.verdict === "ok");
        // rate_limited·error는 "캘린더가 죽었다"가 아니라 "이번엔 알 수 없다"다.
        const inconclusive = actionable.filter((r) => r.verdict === "rate_limited" || r.verdict === "error");
        const needsOrgAction = actionable.filter(
            (r) => r.verdict !== "ok" && r.verdict !== "rate_limited" && r.verdict !== "error",
        );

        const sumBlocked = (list: ProbeRow[]) => list.reduce((n, r) => n + r.blockedVehicleCount, 0);

        const summary = {
            probedRows: rows.length,
            probedVehicles: rows.reduce((n, r) => n + r.vehicleCount, 0),
            blockedVehicles: sumBlocked(blocked),
            calendarApiCalls: needsApi.length,
            okRows: rows.filter((r) => r.verdict === "ok").length,
            resettableRows: resettable.length,
            resettableVehicles: sumBlocked(resettable),
            needsOrgActionRows: needsOrgAction.length,
            needsOrgActionVehicles: sumBlocked(needsOrgAction),
            inconclusiveRows: inconclusive.length,
            inconclusiveVehicles: sumBlocked(inconclusive),
            falsePositiveRows: falsePositives.length,
            falsePositiveVehicles: sumBlocked(falsePositives),
            truncated,
            totalRows: allTargets.length,
        };

        log("INFO", "probeCalendarAccess", "캘린더 접근 진단 완료", summary);

        // 심각한 것부터 보이게 정렬한다 (판정 → 막힌 차량 수 → 기관명).
        const order: Record<ProbeVerdict, number> = {
            not_found: 0, forbidden: 1, bound_to_other_org: 2, service_account_address: 3,
            malformed: 4, rate_limited: 5, error: 6, ok: 7,
        };
        rows.sort((a, b) =>
            order[a.verdict] - order[b.verdict] ||
            b.blockedVehicleCount - a.blockedVehicleCount ||
            a.organizationName.localeCompare(b.organizationName, "ko"),
        );

        return { summary, rows };
    },
);
