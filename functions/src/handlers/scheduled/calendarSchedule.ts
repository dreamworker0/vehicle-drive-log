/**
 * calendarSchedule — Google Calendar → App 역동기화 스케줄러
 */
import { createHash } from "crypto";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { listCalendarEvents, parseEventToReservation } from "../../services/calendar/calendarSync";
import { isGoogleCalendarEnabled, type OrgCalendarFlagCache } from "../../services/calendar/calendarFeature";
import { isCalendarBoundToOrg, type CalendarBindingCache } from "../../services/calendar/calendarBinding";
import { RETRY_COOLDOWN_MS, MAX_FAIL_COUNT, isCalendarAuthError, recordCalendarFailure, resetCalendarFailure } from "../../services/calendar/calendarFailTracking";
import { sendDiscordAlert } from "../../core/discord";
import { recordHeartbeat } from "../../utils/helpers";
import { toKSTDate, getKSTDateString } from "../../utils/kstDate";
import { maskEmail } from "../../utils/mask";

const db = getFirestore();
const auth = getAuth();

/**
 * 캘린더 지문 형식 버전 — 파서(`parseEventToReservation`)나 비교 규칙을 바꾸면 올린다.
 * 지문이 전부 달라져 배포 직후 첫 주기에 모든 차량이 한 번씩 전체 동기화된다.
 */
const CALENDAR_FINGERPRINT_VERSION = 1;

/**
 * 캘린더 이벤트 목록의 지문.
 *
 * 역동기화는 하루 34회 돌며 차량마다 9일치 예약을 매번 다시 읽었다. 캘린더가 그대로면
 * 그 읽기는 아무것도 바꾸지 못하는데도 하루 읽기의 대부분을 차지했다(2026-09-25 점검,
 * 무료 한도 5만/일 중 3.7만). 지문이 직전과 같으면 예약 조회부터 건너뛴다.
 *
 * 지문에 넣는 것:
 * - 이벤트별 `id`·`status`·`updated`·시작/종료 — `updated`는 제목·설명 수정에도 바뀐다
 * - 캘린더 ID와 파서가 쓰는 차량 필드(표시 이름·이름·번호판·기관) — 바뀌면 파싱 결과가 달라진다
 * - KST 날짜 — 조회 창이 하루씩 밀리고, 캘린더 밖의 사정(앱에서 지운 예약 등)도
 *   **하루 한 번은** 전체 동기화로 맞춰지게 하는 안전망
 * - 형식 버전
 *
 * Google `syncToken`을 쓰지 않은 이유: `timeMin`/`timeMax`와 함께 쓸 수 없어 조회 창
 * 대신 캘린더 전체 변경분을 추적해야 하고, 토큰 만료(410) 처리가 따로 필요하다.
 * 이벤트 조회는 어차피 매 주기 하므로, 그 결과로 판정하면 Firestore 읽기만 정확히 줄어든다.
 */
export function computeCalendarFingerprint(
    events: Array<{ id: string; status?: string; updated?: string; start?: unknown; end?: unknown }>,
    vehicleData: FirebaseFirestore.DocumentData,
    kstDate: string
): string {
    const eventKeys = events
        .map(function (e) {
            return [e.id, e.status || "", e.updated || "", JSON.stringify(e.start ?? null), JSON.stringify(e.end ?? null)].join("|");
        })
        .sort();
    const payload = JSON.stringify({
        v: CALENDAR_FINGERPRINT_VERSION,
        date: kstDate,
        calendarId: vehicleData.googleCalendarId || "",
        organizationId: vehicleData.organizationId || "",
        displayName: vehicleData.displayName || "",
        name: vehicleData.name || "",
        plateNumber: vehicleData.plateNumber || "",
        events: eventKeys,
    });
    return createHash("sha256").update(payload).digest("hex");
}

/** 이벤트 조회 함수 — 정기 실행은 같은 캘린더를 한 번만 조회하도록 감싼 것을 넘긴다. */
type ListEventsFn = typeof listCalendarEvents;

/**
 * 실행 한 번 안에서 같은 캘린더의 이벤트 조회를 한 번으로 줄인다.
 *
 * 한 기관이 여러 차량에 같은 캘린더를 쓰는 경우가 많다(2026-09-25 실측: 동기화 대상 95대가
 * 캘린더 45개, 한 캘린더를 14대가 쓰는 기관도 있다). 예전에는 차량마다 같은 캘린더를 다시
 * 조회해, 실행당 약 42초 중 대부분이 캘린더 API 응답 대기였다. Cloud Run은 기다리는 시간도
 * 과금하므로 이 함수가 함수 과금 시간의 25%(요금 1위 SKU의 최대 몫)를 차지했다.
 *
 * - 키에 조회 창(timeMin·timeMax)을 넣는다 — 자정을 넘기며 창이 바뀌면 다시 조회한다.
 * - 실패한 조회는 캐시에서 지운다. 다음 차량이 다시 시도하고, 차량마다 실패 카운터가
 *   예전처럼 따로 쌓인다(권한 오류가 한 차량에만 기록되는 일이 없다).
 * - 조회 순서는 그대로다. 기관 기능·캘린더 귀속 검사를 통과한 차량만 조회를 요청하므로,
 *   남의 캘린더에는 여전히 요청조차 보내지 않는다.
 */
export function createCachedEventLister(list: ListEventsFn = listCalendarEvents): { listEvents: ListEventsFn; fetchCount: () => number } {
    const cache = new Map<string, ReturnType<ListEventsFn>>();
    let fetches = 0;
    const listEvents: ListEventsFn = (calendarId, timeMin, timeMax) => {
        const key = calendarId + "|" + timeMin + "|" + timeMax;
        const cached = cache.get(key);
        if (cached) return cached;
        fetches++;
        const pending = list(calendarId, timeMin, timeMax);
        cache.set(key, pending);
        pending.catch(function () { cache.delete(key); });
        return pending;
    };
    return { listEvents, fetchCount: () => fetches };
}

/** Firestore는 결과가 없는 쿼리도 1건으로 과금한다. */
function queryReadCount(snap: { docs: unknown[] }): number {
    return Math.max(1, snap.docs.length);
}

/**
 * 이메일로 Firebase Auth 사용자 조회 (UID + displayName)
 */
async function findUserByEmail(email: string) {
    if (!email) return null;
    try {
        return await auth.getUserByEmail(email);
    } catch {
        return null;
    }
}

/**
 * Google Calendar -> App 역동기화 (평일 06~22시, 30분마다)
 * 비용 최적화: 주말 및 심야(23~05시) 스킵, 실패 캘린더 자동 제외
 */
export const syncCalendarToApp = onSchedule(
    {
        schedule: "0,30 6-22 * * 1-5", // 평일(월~금) 06시부터 22시까지 매시 0·30분 (30분 주기)
        timeZone: "Asia/Seoul",
        retryCount: 0,
        memory: "512MiB",
        // CPU 분수 할당 — firebase-functions v2는 메모리와 무관하게 모든 함수에 1 vCPU를 붙인다
        // (options.d.ts: "Defaults to 1 for functions with <= 2GB RAM"). Cloud Run 요금은 vCPU-초가
        // GiB-초보다 약 10배 비싸므로 여기가 실질 지렛대다. gcf_gen1은 gen1의 분수 CPU로 되돌린다.
        // 이 함수는 외부 API·Firestore 응답을 기다리는 시간이 대부분이라 CPU를 줄여도 소요가 그만큼
        // 늘지 않는다. concurrency는 cpu<1이면 1이어야 하는데, 스케줄 함수는 한 번에 한 번만 도니
        // 손해가 없다. **전역 concurrency(80)를 그대로 두면 배포가 거부되므로 반드시 명시한다.**
        // (2026-08-29 Cloud Run 비용 점검 — 야간 배치 3종은 타임아웃 여유가 없어 제외했다)
        cpu: "gcf_gen1",
        concurrency: 1,
        // CPU를 1/3로 줄이는 만큼 상한에 여유를 둔다. Cloud Run은 실제 실행 시간만 과금하므로
        // 여유 자체에는 비용이 없고, 늘어난 소요가 상한에 닿아 통째로 실패하는 쪽이 훨씬 나쁘다.
        timeoutSeconds: 300,
    },
    async function () {
        // 주말(토/일) 및 심야 시간(23시~05시) 동기화 스킵 (방어적 코드)
        const nowKST = toKSTDate();
        const dayOfWeek = nowKST.getDay(); // 0=일, 6=토
        const hour = nowKST.getHours();

        if (dayOfWeek === 0 || dayOfWeek === 6 || hour < 6 || hour > 22) {
            console.log(`=== Calendar sync skipped (weekend or night: ${hour}시) ===`);
            await recordHeartbeat("syncCalendarToApp");
            return;
        }

        console.log("=== Calendar -> App reverse sync start ===");

        try {
            // googleCalendarId가 있는 모든 차량 조회
            const vehiclesSnap = await db.collection("vehicles")
                .where("googleCalendarId", "!=", "")
                .get();

            if (vehiclesSnap.empty) {
                console.log("No calendar-linked vehicles, skip");
                return;
            }

            // 조회 범위: 오늘 기준 -1일 ~ +7일
            const now = new Date();
            const timeMin = new Date(now);
            timeMin.setDate(timeMin.getDate() - 1);
            timeMin.setHours(0, 0, 0, 0);
            const timeMax = new Date(now);
            timeMax.setDate(timeMax.getDate() + 7);
            timeMax.setHours(23, 59, 59, 999);

            let totalCreated = 0;
            let totalUpdated = 0;
            let totalCancelled = 0;
            let totalSkippedDup = 0;
            let totalSkippedCooldown = 0;
            let totalSkippedPermanent = 0;
            let totalSkippedUnchanged = 0;
            let totalFullSynced = 0;
            // 읽기 집계 — 하루 읽기의 출처를 로그로 확인하려고 둔다 (2026-09-25 무료 한도 74% 점검)
            let reservationReads = 0;

            const globalProcessedEventIds = new Set<string>();
            // 이 실행에서만 유효한 기관 플래그 캐시 — 한 기관에 차량이 여러 대여도
            // organizations 문서를 한 번만 읽는다 (하루 34회 × 차량 대수만큼 절약).
            const orgFlagCache: OrgCalendarFlagCache = new Map();
            // 캘린더 바인딩 판정도 실행 단위로 모은다 (한 기관이 여러 차량에 같은 캘린더를 쓴다).
            const bindingCache: CalendarBindingCache = new Map();
            // 같은 캘린더를 쓰는 차량끼리 이벤트 조회 결과를 나눠 쓴다
            const eventLister = createCachedEventLister();

            for (let i = 0; i < vehiclesSnap.docs.length; i++) {
                const vehicleDoc = vehiclesSnap.docs[i];
                const vehicle = vehicleDoc.data();
                const vehicleId = vehicleDoc.id;
                const calendarId = vehicle.googleCalendarId as string;
                const vehicleName = (vehicle.displayName as string) || "";

                // 유효하지 않은 캘린더 ID 건너뛰기 (@ 포함 필수)
                if (!calendarId || !calendarId.includes("@")) {
                    console.log("Vehicle " + vehicleName + "(" + vehicleId + "): invalid calendar ID, skip");
                    continue;
                }

                // 연속 실패 횟수에 따른 동기화 제외 판단
                const failCount = (vehicle.calendarSyncFailCount as number) || 0;
                if (failCount >= MAX_FAIL_COUNT) {
                    // 10회 이상: 영구 제외 (수동 리셋 필요)
                    totalSkippedPermanent++;
                    continue;
                }
                if (failCount >= 3) {
                    // 3~9회: 24시간 쿨다운 후 1회 재시도
                    const lastFailAt = vehicle.calendarSyncLastFailAt;
                    const lastFailTime = lastFailAt?.toDate?.() || lastFailAt;
                    if (lastFailTime && (Date.now() - new Date(lastFailTime).getTime()) < RETRY_COOLDOWN_MS) {
                        totalSkippedCooldown++;
                        continue;
                    }
                    console.log("Vehicle " + vehicleName + "(" + vehicleId + "): 24h cooldown passed, retrying (failCount: " + failCount + ")");
                }

                try {
                    // 개별 차량 동기화 로직 호출
                    const result = await syncSingleVehicleCalendar(
                        vehicleId, vehicle, globalProcessedEventIds, orgFlagCache, bindingCache,
                        { skipIfUnchanged: true, listEvents: eventLister.listEvents }
                    );

                    totalCreated += result.created;
                    totalUpdated += result.updated;
                    totalCancelled += result.cancelled;
                    totalSkippedDup += result.skippedDup;
                    reservationReads += result.reads;
                    if (result.skippedUnchanged) totalSkippedUnchanged++;
                    else totalFullSynced++;

                    // 동기화 성공 시 실패 카운터 리셋
                    if (failCount > 0) {
                        await resetCalendarFailure(vehicleId);
                    }
                } catch (vehicleErr: unknown) {
                    const errMsg = (vehicleErr as Error).message;
                    console.error("Vehicle " + vehicleName + "(" + vehicleId + ") sync failed:", errMsg);

                    // Not Found / 인증 에러 시 실패 카운터 증가
                    if (isCalendarAuthError(vehicleErr)) {
                        const newFailCount = await recordCalendarFailure(vehicleId, failCount, vehicleErr);
                        if (newFailCount >= MAX_FAIL_COUNT) {
                            console.warn("Vehicle " + vehicleName + "(" + vehicleId + "): permanently disabled after " + newFailCount + " failures");
                        } else if (newFailCount >= 3) {
                            console.warn("Vehicle " + vehicleName + "(" + vehicleId + "): cooldown activated after " + newFailCount + " failures (retry in 24h)");
                        }
                    }
                }
            }

            console.log("=== Reverse sync done: created " + totalCreated + ", updated " + totalUpdated + ", cancelled " + totalCancelled + ", skippedDup " + totalSkippedDup + ", skippedCooldown " + totalSkippedCooldown + ", skippedPermanent " + totalSkippedPermanent + " ===");

            // 캐시 미스 한 번이 문서 읽기 한 번이다(바인딩 경합 재조회는 드물어 뺐다).
            const vehicleReads = queryReadCount(vehiclesSnap);
            const orgAndBindingReads = orgFlagCache.size + bindingCache.size;
            const totalReads = vehicleReads + reservationReads + orgAndBindingReads;
            // 고정 접두사로 남겨 Cloud Logging에서 `[CalendarSyncReads]`로 모아 볼 수 있게 한다.
            console.log("[CalendarSyncReads] " + JSON.stringify({
                totalReads,
                vehicleReads,
                reservationReads,
                orgAndBindingReads,
                calendarFetches: eventLister.fetchCount(),
                fullSynced: totalFullSynced,
                skippedUnchanged: totalSkippedUnchanged,
            }));

            // [이상 감지 알림] 한 주기(30분) 동안 예약 증식이 10건 이상이면 비정상 폭증으로 간주
            if (totalCreated >= 10) {
                await sendDiscordAlert({
                    title: "🚨 [긴급] 캘린더 동기화 시스템 예외 상황 감지",
                    description: `한 번의 동기화 주기(30분) 내에 **${totalCreated}건**의 예약이 새롭게 생성되었습니다.\n무한 증식 버그이거나 일시적인 폭증일 수 있으므로 Firestore 및 이벤트 로그 점검이 필요합니다.`,
                    color: 16711680
                });
            }

            await recordHeartbeat("syncCalendarToApp");
        } catch (err: unknown) {
            console.error("Reverse sync overall failed:", (err as Error).message);
        }
    }
);

/**
 * 단일 차량 구글 캘린더 동기화 핵심 로직
 */
export async function syncSingleVehicleCalendar(
    vehicleId: string,
    vehicleData: FirebaseFirestore.DocumentData,
    globalProcessedEventIds: Set<string> = new Set<string>(),
    // 차량 순회 호출자가 실행 단위 Map을 넘기면 같은 기관의 문서를 한 번만 읽는다.
    // 단일 차량 호출(온디맨드 동기화)에서는 중복이 없으므로 넘기지 않아도 된다.
    orgFlagCache?: OrgCalendarFlagCache,
    // 캘린더 바인딩 판정 캐시 — 한 기관이 모든 차량에 같은 캘린더를 쓰는 경우가 많아
    // orgFlagCache와 같은 이유로 실행 단위 Map을 받는다.
    bindingCache?: CalendarBindingCache,
    // skipIfUnchanged: 캘린더 지문이 차량 문서의 직전 값과 같으면 예약 조회·비교를 건너뛴다.
    // 정기 스케줄러만 켠다 — 온디맨드 동기화는 사용자가 "지금 맞춰 달라"고 누른 것이라 항상 전체로 돈다.
    // listEvents: 이벤트 조회 함수. 정기 실행은 캘린더별로 한 번만 조회하는 캐시판을 넘긴다.
    options: { skipIfUnchanged?: boolean; listEvents?: ListEventsFn } = {}
): Promise<{
    created: number;
    updated: number;
    cancelled: number;
    skippedDup: number;
    /** 이 함수 안에서 발생한 Firestore 읽기 수 (기관 플래그·바인딩 조회는 호출자 캐시로 집계) */
    reads: number;
    /** 캘린더 지문이 같아 예약 조회를 건너뛰었는지 */
    skippedUnchanged: boolean;
}> {
    const calendarId = vehicleData.googleCalendarId as string;
    const vehicleName = (vehicleData.displayName as string) || "";
    const organizationId = vehicleData.organizationId as string;

    let created = 0;
    let updated = 0;
    let cancelled = 0;
    let skippedDup = 0;
    let reads = 0;
    const skippedUnchanged = false;

    if (!await isGoogleCalendarEnabled(organizationId, orgFlagCache)) {
        console.log("Vehicle " + vehicleName + "(" + vehicleId + "): organization calendar feature disabled, skip");
        return { created, updated, cancelled, skippedDup, reads, skippedUnchanged };
    }

    // 유효하지 않은 캘린더 ID 건너뛰기 (@ 포함 필수)
    if (!calendarId || !calendarId.includes("@")) {
        console.log("Vehicle " + vehicleName + "(" + vehicleId + "): invalid calendar ID, skip");
        return { created, updated, cancelled, skippedDup, reads, skippedUnchanged };
    }

    // 이 캘린더가 이 기관에 귀속된 것인지 확인한다. 이 검사가 없으면 관리자가 적어 넣은
    // 남의 캘린더 ID로 그 기관의 일정이 우리 예약으로 유입된다 (2026-08-23 감사 발견 1).
    // 캘린더 API 호출 **앞에** 둔다 — 막을 요청은 보내지도 않는다.
    if (!await isCalendarBoundToOrg(calendarId, organizationId, {
        logName: "syncCalendarToApp",
        cache: bindingCache,
    })) {
        console.log("Vehicle " + vehicleName + "(" + vehicleId + "): calendar not bound to this organization, skip");
        return { created, updated, cancelled, skippedDup, reads, skippedUnchanged };
    }

    // 조회 범위: 오늘 기준 -1일 ~ +7일
    const now = new Date();
    const timeMin = new Date(now);
    timeMin.setDate(timeMin.getDate() - 1);
    timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(now);
    timeMax.setDate(timeMax.getDate() + 7);
    timeMax.setHours(23, 59, 59, 999);

    // 1. 캘린더 이벤트 조회
    const calendarEvents = await (options.listEvents ?? listCalendarEvents)(
        calendarId,
        timeMin.toISOString(),
        timeMax.toISOString()
    );

    // 캘린더가 직전 전체 동기화 이후 그대로면 Firestore는 볼 것도 바꿀 것도 없다.
    const fingerprint = computeCalendarFingerprint(calendarEvents, vehicleData, getKSTDateString(now));
    if (options.skipIfUnchanged && vehicleData.calendarSyncFingerprint === fingerprint) {
        return { created, updated, cancelled, skippedDup, reads, skippedUnchanged: true };
    }

    // 2. 해당 차량의 기존 예약 조회 (UTC/KST 시간대 오류를 피하기 위해 조회 범위를 하루씩 넉넉히 잡습니다)
    const dateMinObj = new Date(timeMin);
    dateMinObj.setDate(dateMinObj.getDate() - 2);
    const dateMin = getKSTDateString(dateMinObj);
    
    const dateMaxObj = new Date(timeMax);
    dateMaxObj.setDate(dateMaxObj.getDate() + 2);
    const dateMax = getKSTDateString(dateMaxObj);

    const existingSnap = await db.collection("reservations")
        .where("vehicleId", "==", vehicleId)
        .where("date", ">=", dateMin)
        .where("date", "<=", dateMax)
        .get();
    reads += queryReadCount(existingSnap);

    const existingByEventId: Record<string, Record<string, unknown>> = {};
    const existingReservations: Array<Record<string, unknown>> = [];
    existingSnap.docs.forEach(function (d) {
        const data: Record<string, unknown> = { id: d.id, ...d.data() };
        existingReservations.push(data);
        if (data.calendarEventId) {
            existingByEventId[data.calendarEventId as string] = data;
            // 이미 존재하는 예약의 calendarEventId를 전역 Set에 등록
            if (data.status !== "cancelled") {
                globalProcessedEventIds.add(data.calendarEventId as string);
            }
        }
    });

    const calendarEventIds = new Set(calendarEvents.map(function (e) { return e.id; }));

    // 3. 캘린더 이벤트 기준으로 동기화
    for (let j = 0; j < calendarEvents.length; j++) {
        const calEvent = calendarEvents[j];
        // 취소된 이벤트는 건너뜀
        if (calEvent.status === "cancelled") continue;

        let existing = existingByEventId[calEvent.id];

        if (!existing) {
            // calendarEventId로 연결되지 않은 예약 중에서, 동일 조건(날짜, 시간, 차량)의 앱 생성 예약 찾기
            const tempParsed = parseEventToReservation(calEvent, vehicleId, vehicleName, organizationId, vehicleData) as Record<string, unknown>;
            const matchingAppReservation = existingReservations.find(function (r) {
                return r.date === tempParsed.date &&
                       r.startTime === tempParsed.startTime &&
                       r.endTime === tempParsed.endTime &&
                       r.vehicleId === vehicleId &&
                       r.status !== "cancelled" &&
                       !r.calendarEventId; // 아직 calendarEventId가 없는 예약 (최신 생성 등)
            });

            if (matchingAppReservation) {
                // 앱에서 생성되었으나 아직 calendarEventId가 매핑되지 않은 예약 발견
                existing = matchingAppReservation;
                // Firestore에 calendarEventId 업데이트 후 중첩 방지
                await db.collection("reservations").doc(existing.id as string).update({
                    calendarEventId: calEvent.id
                });
                existing.calendarEventId = calEvent.id;
                existingByEventId[calEvent.id] = existing;
                globalProcessedEventIds.add(calEvent.id);
                console.log("[" + vehicleName + "] Linked unmapped app reservation " + existing.id + " with calendar event " + calEvent.id);
            }
        }

        if (!existing) {
            // 같은 calendarEventId가 다른 차량에서 이미 처리되었으면 건너뛰기
            if (globalProcessedEventIds.has(calEvent.id)) {
                skippedDup++;
                console.log("[" + vehicleName + "] Skip duplicate calendarEventId: " + calEvent.id + " (" + calEvent.summary + ")");
                continue;
            }

            // [결정적 버그 픽스] date 필터 밖으로 벗어났거나, 이미 존재하는 이벤트인지 최종 점검 (Double Check)
            const doubleCheckSnap = await db.collection("reservations")
                .where("calendarEventId", "==", calEvent.id)
                .limit(1)
                .get();
            reads += queryReadCount(doubleCheckSnap);

            if (!doubleCheckSnap.empty) {
                const dupDoc = doubleCheckSnap.docs[0];
                existingByEventId[calEvent.id] = { id: dupDoc.id, ...dupDoc.data() };
                globalProcessedEventIds.add(calEvent.id);
                console.log("[" + vehicleName + "] Found existing event out of date range for calendarEventId: " + calEvent.id);
                // 기존 문서가 있음 처리로 넘기기 위해 루프 강제 분기
                existing = existingByEventId[calEvent.id];
            }
        }

        // 위 더블체크 로직을 거쳐도 existing이 없으면 진짜 새로 만듦
        if (!existing) {
            // 새 이벤트 -> Firestore에 예약 생성
            const reservationData = parseEventToReservation(
                calEvent, vehicleId, vehicleName, organizationId, vehicleData
            ) as Record<string, unknown>;

            // creator.email로 사용자 UID 및 이름 조회
            if (reservationData.creatorEmail) {
                const userRecord = await findUserByEmail(reservationData.creatorEmail as string);
                if (userRecord) {
                    reservationData.reservedByUid = userRecord.uid;
                    reservationData.userId = userRecord.uid;
                    if (!reservationData.reservedByName) {
                        if (userRecord.displayName) {
                            reservationData.reservedByName = userRecord.displayName;
                        } else {
                            // 이메일/비밀번호 계정은 Auth displayName이 비어 있는 경우가 많아
                            // Firestore 프로필(users/{uid}.name)로 폴백
                            const profileSnap = await db.collection("users").doc(userRecord.uid).get();
                            reads += 1;
                            const profileName = profileSnap.exists ? (profileSnap.data()?.name as string | undefined) : undefined;
                            if (profileName) reservationData.reservedByName = profileName;
                        }
                    }
                    console.log("[" + vehicleName + "] User matched: " + maskEmail(reservationData.creatorEmail as string) + " -> " + userRecord.uid);
                }
                // 최종 폴백: 이메일 로컬파트 — "예약자 미상"으로 남지 않게 최소 식별자 제공
                // (개인정보 보호를 위해 이메일 전체는 저장하지 않음)
                if (!reservationData.reservedByName) {
                    reservationData.reservedByName = (reservationData.creatorEmail as string).split("@")[0];
                }
            }

            // creatorEmail은 Firestore에 저장하지 않음
            delete reservationData.creatorEmail;

            reservationData.createdAt = FieldValue.serverTimestamp();
            // [원천 차단] 예약 생성 시 임의의 난수 ID 대신 구글 캘린더 이벤트 ID를 문서 ID로 고정하여 절대 중복 생성되지 않게 함
            await db.collection("reservations").doc(calEvent.id).set(reservationData);
            globalProcessedEventIds.add(calEvent.id);
            created++;
            console.log("[" + vehicleName + "] New reservation: " + calEvent.summary + " (" + calEvent.id + ")");
        } else {
            // 기존 예약이 있음 -> 내용 비교 후 업데이트
            const parsed = parseEventToReservation(
                calEvent, vehicleId, vehicleName, organizationId, vehicleData
            );

            /**
             * **파싱이 목적지를 알아내지 못했으면 기존 값을 그대로 둔다.**
             *
             * 제목이 차량 이름뿐이면 파서가 목적지를 비우는데(2026-09-15), 그 빈 값으로 기존
             * 예약을 덮으면 **사용자의 구글 캘린더 일정이 앱에 의해 지워진다.** 갱신은
             * `syncSource: "calendar"`를 다시 써 넣고, `reservationTriggers`의 루프 가드는
             * `before.syncSource !== "calendar"`일 때만 막으므로 calendar → calendar 갱신은
             * 통과한다. 그러면 정방향 write-back이 `events.update`(PATCH가 아니라 **전체 PUT**)로
             * 제목·설명·참석자·알림을 `buildEvent` 결과로 덮고, 제목이 `[스파크] 예약`이 된다.
             * 다음 동기화가 그것을 다시 읽어 **목적지가 "예약"으로 굳는다** — 차량명이 아니라
             * 파서의 가드도 잡지 못한다. 원래 버그보다 나쁘다.
             *
             * 그래서 빈 파싱 결과는 "값이 바뀌었다"가 아니라 **"알아내지 못했다"**로 다룬다.
             * 기존 예약은 자동으로 정리되지 않는다 — 대신 운행일지 저장 쪽 검사가 받는다.
             */
            const resolved = {
                ...parsed,
                destination: parsed.destination || (existing.destination as string) || "",
            };

            const fieldsToCompare = ["date", "startTime", "endTime", "purpose", "destination"];
            const changed = fieldsToCompare.some(function (f) { return (resolved as Record<string, unknown>)[f] !== existing[f]; });

            if (changed && existing.syncSource === "calendar") {
                await db.collection("reservations").doc(existing.id as string).update({
                    date: parsed.date,
                    startTime: parsed.startTime,
                    endTime: parsed.endTime,
                    purpose: resolved.purpose,
                    destination: resolved.destination,
                    reservedByName: resolved.reservedByName,
                    syncSource: "calendar",
                });
                updated++;
                console.log("[" + vehicleName + "] Reservation updated: " + existing.id);
            }
        }
    }

    // 4. Firestore에만 있고 캘린더에 없는 (캘린더에서 삭제된) 이벤트 처리
    for (let k = 0; k < existingReservations.length; k++) {
        const reservation = existingReservations[k];
        if (
            reservation.calendarEventId &&
            reservation.syncSource === "calendar" &&
            reservation.status !== "cancelled" &&
            !calendarEventIds.has(reservation.calendarEventId as string)
        ) {
            await db.collection("reservations").doc(reservation.id as string).update({
                status: "cancelled",
                syncSource: "calendar",
            });
            cancelled++;
            console.log("[" + vehicleName + "] Reservation cancelled (calendar deleted): " + reservation.id);
        }
    }

    // 전체 동기화를 끝까지 마친 뒤에만 지문을 남긴다 — 중간에 throw하면 다음 주기가 다시 전체로 돈다.
    // 차량 문서에는 트리거가 없고, 실패 카운터도 같은 문서에 기록하므로 같은 방식이다.
    if (vehicleData.calendarSyncFingerprint !== fingerprint) {
        await db.collection("vehicles").doc(vehicleId).update({ calendarSyncFingerprint: fingerprint });
    }

    return { created, updated, cancelled, skippedDup, reads, skippedUnchanged };
}

/**
 * 특정 단일 차량에 대해서만 구글 캘린더 이벤트를 즉시 동기화합니다. (웹훅 등에서 호출용)
 * 기존 스케줄러의 동기화 로직과 유사한 기능을 개별 차량 단위로 좁혀서 실행할 수 있습니다.
 */
export async function syncVehicleCalendar(vehicleId: string, vehicleInfo: Record<string, unknown>) {
    const calendarId = vehicleInfo.googleCalendarId as string;
    const vehicleName = (vehicleInfo.displayName as string) || "";
    
    if (!calendarId || !calendarId.includes("@")) {
        console.log(`[SyncVehicle] Vehicle ${vehicleName}(${vehicleId}) invalid calendar ID, skip`);
        return;
    }
    
    console.log(`[SyncVehicle] Start single vehicle sync for ${vehicleName} (${vehicleId})`);
    
    try {
        await syncSingleVehicleCalendar(vehicleId, vehicleInfo);
    } catch (err: unknown) {
        console.error(`[SyncVehicle] Single sync failed for ${vehicleName}:`, (err as Error).message);
    }
}
