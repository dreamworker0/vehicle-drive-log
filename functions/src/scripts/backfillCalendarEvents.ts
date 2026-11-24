/**
 * backfillCalendarEvents — 캘린더에 빠진 예약 일정 보충 (슈퍼관리자 호출용)
 *
 * ## 왜 필요한가 (2026-11-24)
 *
 * 2026-10-25부터 예약 트리거가 256MiB 한도를 넘어 메모리 초과로 죽었다(#614에서 512MiB로 수정).
 * 트리거는 재시도가 없고 앱 예약을 캘린더로 다시 올리는 경로도 없어서, 그 사이 죽은 예약은
 * **캘린더에 끝내 올라가지 않았다.** 같은 이유로 취소할 때 일정 삭제가 죽은 예약은 캘린더에
 * 취소된 일정이 그대로 남았다. 이 함수는 그 둘을 앞으로의 날짜에 한해 메운다.
 *
 * - **누락 생성**: `since` 이후 만들어진 확정(reserved) 예약 중 날짜가 오늘 이후이고
 *   `calendarEventId`가 없는 것 → 캘린더에 일정을 만들고 ID를 저장한다. 같은 제목·시각의
 *   일정이 이미 있으면 새로 만들지 않고 연결만 한다.
 * - **잔존 삭제**: 같은 기간의 취소(cancelled) 예약 중 날짜가 오늘 이후이고 `calendarEventId`가
 *   남은 것 → 일정을 지운다. 이미 지워진 일정은 404/410으로 조용히 넘어간다(deleteCalendarEvent).
 *
 * 트리거와 같은 기준으로만 캘린더를 건드린다 — 기관 기능 꺼짐·바인딩 불일치·실패 누적(쿨다운)
 * 차량은 건너뛴다. 실패는 차량 실패 카운터에 세지 않는다(일회성 운영 작업이 기관 알림을
 * 일으키지 않게). 지난 날짜는 손대지 않는다 — 이미 지나간 일정을 지금 만들면 기관 캘린더 기록만
 * 어지럽힌다.
 *
 * `dryRun: true`면 아무것도 쓰지 않고 할 일만 센다. 화면은 미리 보기 → 확인 → 실행 순서로 부른다.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, Timestamp, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { log, requireSuperAdmin } from "../utils/helpers";
import { getKSTDateString } from "../utils/kstDate";
import { isGoogleCalendarEnabled, type OrgCalendarFlagCache } from "../services/calendar/calendarFeature";
import { isCalendarBoundToOrg, type CalendarBindingCache } from "../services/calendar/calendarBinding";
import { shouldSkipVehicleCalendar } from "../services/calendar/calendarFailTracking";
import { createCalendarEvent, deleteCalendarEvent, findMatchingCalendarEventId } from "../services/calendar/calendarSync";

/** 기본 시작일 — 메모리 초과가 처음 나온 날 */
const DEFAULT_SINCE = "2026-10-25";
/** 한 번 호출에서 캘린더를 부르는 상한 — 시간 제한(540초) 안에 끝내기 위함. 남으면 다시 누른다. */
const MAX_CALENDAR_CALLS = 400;

interface OrgSummary {
    orgName: string;
    toCreate: number;
    toDelete: number;
    created: number;
    linked: number;
    deleted: number;
    skippedVehicle: number;
    failed: number;
}

export interface BackfillResult {
    dryRun: boolean;
    since: string;
    toCreate: number;
    toDelete: number;
    created: number;
    linked: number;
    deleted: number;
    skippedVehicle: number;
    failed: number;
    remaining: number;
    orgs: OrgSummary[];
    message: string;
}

type VehicleCtx = { calendarId: string; orgId: string } | null;

export const backfillCalendarEvents = onCall(
    {
        region: "asia-northeast3",
        timeoutSeconds: 540,
        // googleapis를 불러온다 — cloud-functions.md §3.2
        memory: "512MiB",
        enforceAppCheck: false,
    },
    async (request): Promise<BackfillResult> => {
        requireSuperAdmin(request);

        const dryRun = request.data?.dryRun !== false;
        const since = typeof request.data?.since === "string" ? request.data.since : DEFAULT_SINCE;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
            throw new HttpsError("invalid-argument", "since는 YYYY-MM-DD 형식이어야 합니다.");
        }
        const sinceTs = Timestamp.fromDate(new Date(`${since}T00:00:00+09:00`));
        const today = getKSTDateString();
        const db = getFirestore();

        log("INFO", "backfillCalendarEvents", "캘린더 누락 보충 시작", { uid: request.auth?.uid, dryRun, since });

        const snap = await db.collection("reservations").where("createdAt", ">=", sinceTs).get();

        const vehicleCache = new Map<string, VehicleCtx>();
        const orgFlagCache: OrgCalendarFlagCache = new Map();
        const bindingCache: CalendarBindingCache = new Map();
        const orgNames = new Map<string, string>();
        const orgs = new Map<string, OrgSummary>();

        async function orgSummary(orgId: string): Promise<OrgSummary> {
            let s = orgs.get(orgId);
            if (!s) {
                if (!orgNames.has(orgId)) {
                    const o = await db.collection("organizations").doc(orgId).get();
                    orgNames.set(orgId, (o.data()?.name as string) || orgId);
                }
                s = { orgName: orgNames.get(orgId)!, toCreate: 0, toDelete: 0, created: 0, linked: 0, deleted: 0, skippedVehicle: 0, failed: 0 };
                orgs.set(orgId, s);
            }
            return s;
        }

        /** 트리거의 getVehicleCalendar와 같은 기준. 건너뛸 차량이면 null. */
        async function vehicleCalendar(vehicleId: string, orgId: string): Promise<VehicleCtx> {
            const key = `${vehicleId}:${orgId}`;
            if (vehicleCache.has(key)) return vehicleCache.get(key)!;
            let ctx: VehicleCtx = null;
            const v = await db.collection("vehicles").doc(vehicleId).get();
            const data = v.data();
            const calendarId = (data?.googleCalendarId as string) || "";
            if (
                data
                && data.organizationId === orgId
                && calendarId.includes("@")
                && !shouldSkipVehicleCalendar(data)
                && await isGoogleCalendarEnabled(orgId, orgFlagCache)
                && await isCalendarBoundToOrg(calendarId, orgId, { logName: "backfillCalendarEvents", cache: bindingCache })
            ) {
                ctx = { calendarId, orgId };
            }
            vehicleCache.set(key, ctx);
            return ctx;
        }

        // 할 일 고르기 — 앞으로의 날짜, 역동기화로 들어온 예약 제외
        const creates: QueryDocumentSnapshot[] = [];
        const deletes: QueryDocumentSnapshot[] = [];
        for (const doc of snap.docs) {
            const r = doc.data();
            if (r.syncSource === "calendar") continue;
            if (typeof r.date !== "string" || r.date < today) continue;
            if (!r.vehicleId || !r.organizationId) continue;
            if (r.status === "reserved" && !r.calendarEventId) creates.push(doc);
            else if (r.status === "cancelled" && r.calendarEventId) deletes.push(doc);
        }

        let created = 0, linked = 0, deleted = 0, skippedVehicle = 0, failed = 0, calls = 0, toCreate = 0, toDelete = 0;
        let remaining = 0;

        for (const doc of [...creates, ...deletes]) {
            const r = doc.data();
            const isCreate = r.status === "reserved";
            const vc = await vehicleCalendar(r.vehicleId as string, r.organizationId as string);
            const summary = await orgSummary(r.organizationId as string);
            if (!vc) {
                skippedVehicle++; summary.skippedVehicle++;
                continue;
            }
            if (isCreate) { toCreate++; summary.toCreate++; } else { toDelete++; summary.toDelete++; }
            if (dryRun) continue;
            if (calls >= MAX_CALENDAR_CALLS) { remaining++; continue; }

            try {
                calls++;
                if (isCreate) {
                    const reservation = r as Parameters<typeof createCalendarEvent>[1];
                    const existing = await findMatchingCalendarEventId(vc.calendarId, reservation);
                    const eventId = existing ?? await createCalendarEvent(vc.calendarId, reservation);
                    // calendarEventId만 바꾸는 쓰기는 onReservationUpdated가 무한 루프 방지 가드로 걸러 낸다.
                    await doc.ref.update({ calendarEventId: eventId });
                    if (existing) { linked++; summary.linked++; } else { created++; summary.created++; }
                } else {
                    await deleteCalendarEvent(vc.calendarId, r.calendarEventId as string);
                    deleted++; summary.deleted++;
                }
            } catch (err) {
                failed++; summary.failed++;
                log("WARNING", "backfillCalendarEvents", "보충 실패", {
                    reservationId: doc.id,
                    vehicleId: r.vehicleId,
                    action: isCreate ? "create" : "delete",
                    error: (err as Error).message,
                });
            }
        }

        const orgList = [...orgs.values()]
            .filter((o) => o.toCreate + o.toDelete + o.skippedVehicle > 0)
            .sort((a, b) => (b.toCreate + b.toDelete) - (a.toCreate + a.toDelete));

        const message = dryRun
            ? `보충 대상: 일정 생성 ${toCreate}건, 취소 일정 삭제 ${toDelete}건 (건너뛸 예약 ${skippedVehicle}건 — 연동 꺼짐·실패 누적 차량)`
            : `일정 생성 ${created}건, 기존 일정 연결 ${linked}건, 취소 일정 삭제 ${deleted}건, 실패 ${failed}건`
              + (remaining > 0 ? ` — 남은 ${remaining}건은 한 번 더 실행하세요` : "");

        log("INFO", "backfillCalendarEvents", "캘린더 누락 보충 완료", {
            dryRun, since, toCreate, toDelete, created, linked, deleted, skippedVehicle, failed, remaining,
            orgs: orgList,
        });

        return { dryRun, since, toCreate, toDelete, created, linked, deleted, skippedVehicle, failed, remaining, orgs: orgList, message };
    },
);
