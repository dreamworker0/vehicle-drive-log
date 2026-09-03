/**
 * calendarFailTracking — 공식(차량) 구글 캘린더 동기화 실패 추적 공통 모듈
 *
 * 차량의 googleCalendarId가 삭제·공유해제 등으로 404/403을 반환할 때
 * vehicles 문서의 calendarSyncFailCount / calendarSyncLastFailAt를 갱신한다.
 * 역동기화 스케줄러(calendarSchedule)와 정방향 예약 트리거(reservationTriggers)가
 * 동일한 백오프(쿨다운/영구제외) 정책을 공유하도록 단일 원본으로 둔다.
 */
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/** 쿨다운 재시도 관련 상수 (역동기화/정방향 트리거 공통) */
export const RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24시간
export const MAX_FAIL_COUNT = 10; // 10회 이상 실패 시 영구 제외 (수동 리셋 필요)

/**
 * Google Calendar API의 캘린더 부재/권한 오류(404·403) 여부.
 *
 * **상태 코드를 먼저 본다.** 예전에는 메시지 문자열만 검사했는데(`"404"`·`"403"`·`"Not Found"`),
 * googleapis가 던지는 오류의 message가 숫자 없는 사유 문구(`"Forbidden"`)일 때가 있어
 * 그 경우 이 함수가 false를 반환했다. 그러면 recordCalendarFailure가 호출되지 않아
 * failCount가 0에 머물고, shouldSkipVehicleCalendar의 쿨다운·영구제외가 영영 발동하지 않는다 —
 * 공유가 깨진 차량이 예약이 바뀔 때마다 같은 403을 내고 Sentry에 무한 축적됐다.
 * 코드베이스의 다른 지점(calendarSync·testCalendarAccess)은 이미 숫자 `code`를 본다.
 */
export function isCalendarAuthError(err: unknown): boolean {
    const status = calendarErrorStatus(err);
    return status === 403 || status === 404;
}

/**
 * 캘린더 오류에서 HTTP 상태 코드를 뽑는다 (판별 불가면 null).
 *
 * `isCalendarAuthError`의 판정 근거를 그대로 노출하는 단일 원본이다. 진단 도구
 * (`probeCalendarAccess`)가 자체 추출기를 두면 **운영 경로가 실패로 세어 failCount를
 * 10까지 올린 바로 그 오류를 진단은 "기타 오류"로 분류하는** 어긋남이 생긴다.
 * 숫자 코드가 없고 사유 문구만 오는 형태(`"Forbidden"`)까지 여기서 함께 흡수한다.
 */
export function calendarErrorStatus(err: unknown): number | null {
    const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
    const raw = Number(e?.response?.status ?? e?.status ?? e?.code);
    if (raw === 403 || raw === 404) return raw;
    // 숫자 코드가 없거나 설정 오류를 가리키지 않을 때만 메시지를 본다.
    const msg = (err as Error)?.message || "";
    if (msg.includes("Not Found") || msg.includes("404")) return 404;
    if (msg.includes("Forbidden") || msg.includes("403")) return 403;
    return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * 차량 데이터의 실패 카운트를 보고 캘린더 동기화를 건너뛸지 판단한다.
 * - failCount >= MAX_FAIL_COUNT: 영구 제외
 * - failCount >= 3: 마지막 실패로부터 24시간 이내면 쿨다운으로 스킵
 *
 * (스케줄러는 영구/쿨다운 카운터를 따로 집계하므로 이 함수 대신 인라인 분기를 사용한다.)
 */
export function shouldSkipVehicleCalendar(vehicleData: FirebaseFirestore.DocumentData): boolean {
    const failCount = (vehicleData.calendarSyncFailCount as number) || 0;
    if (failCount >= MAX_FAIL_COUNT) return true;
    if (failCount >= 3) {
        const lastFailAt = vehicleData.calendarSyncLastFailAt;
        const lastFailTime = lastFailAt?.toDate?.() || lastFailAt;
        if (lastFailTime && (Date.now() - new Date(lastFailTime).getTime()) < RETRY_COOLDOWN_MS) {
            return true;
        }
    }
    return false;
}

/** 실패 사유 코드 — 화면이 "무엇을 고쳐야 하는가"를 바로 말할 수 있게 상태 코드를 좁힌다. */
export type CalendarFailReason = "not_found" | "forbidden" | "other";

/** 상태 코드 → 사유 코드 */
export function calendarFailReason(status: number | null): CalendarFailReason {
    if (status === 404) return "not_found";
    if (status === 403) return "forbidden";
    return "other";
}

/** 사유별 기관 안내 문구 — 403과 404는 기관이 할 조치가 다르다. */
const REASON_GUIDE: Record<CalendarFailReason, string> = {
    not_found: "캘린더가 삭제되었거나 캘린더 ID가 올바르지 않습니다.",
    forbidden: "서비스 계정에 준 캘린더 공유 권한이 해제되었습니다.",
    other: "캘린더에 접근할 수 없습니다.",
};

/**
 * 캘린더 인증/부재 오류 시 실패 카운트를 1 증가시키고 마지막 실패 시각·**사유**를 기록한다.
 *
 * 사유를 남기는 이유(2026-09-03 조사): 예전에는 카운터와 시각만 남겨서, 어느 차량이
 * 403(공유 권한 해제)이고 어느 차량이 404(캘린더 삭제)인지 **차량 문서만 봐서는 알 수
 * 없었다.** 둘은 기관이 할 조치가 다르다. 유일한 단서가 Cloud Logging이었는데 보존이
 * 30일이라, 그 전에 영구 제외로 얼어붙은 차량은 원인 규명 자체가 불가능해졌다 —
 * 조사 시점에 67대 중 57대가 정확히 그 상태였다.
 *
 * 카운터는 MAX_FAIL_COUNT를 넘지 않도록 캡한다(영구제외 임계). 일부 경로가 백오프 가드를
 * 빠뜨려도 카운터가 무한 증가(예: 192회)하지 않도록 하는 방어적 불변식이다.
 *
 * @param err 원인 오류. 넘기면 사유를 함께 기록한다(넘기지 않으면 기존 사유를 보존한다).
 * @returns 증가된(캡 적용) 새 failCount
 */
export async function recordCalendarFailure(
    vehicleId: string,
    currentFailCount: number,
    err?: unknown,
): Promise<number> {
    const newFailCount = Math.min(currentFailCount + 1, MAX_FAIL_COUNT);

    const update: Record<string, unknown> = {
        calendarSyncFailCount: newFailCount,
        calendarSyncLastFailAt: FieldValue.serverTimestamp(),
    };
    if (err !== undefined) {
        const status = calendarErrorStatus(err);
        // 상태를 모를 때 지난 사유를 지우면 그나마 있던 진단 근거가 사라진다 — 아는 것만 쓴다.
        if (status !== null) update.calendarSyncLastFailStatus = status;
        update.calendarSyncLastFailReason = calendarFailReason(status);
    }

    await getFirestore().collection("vehicles").doc(vehicleId).update(update);

    // 영구 제외로 **넘어가는 순간**에만 기관에 알린다. 그 뒤로는 호출 자체가 없으므로
    // 여기서 알리지 않으면 기관은 캘린더에 일정이 안 뜨는 이유를 영영 모른다.
    if (newFailCount >= MAX_FAIL_COUNT && currentFailCount < MAX_FAIL_COUNT) {
        try {
            await notifyOrgCalendarDisabled(vehicleId);
        } catch (notifyErr: unknown) {
            // 알림 실패가 실패 기록 자체를 되돌리게 두지 않는다.
            console.error(`[calendarFailTracking] 기관 알림 실패 (${vehicleId}):`, (notifyErr as Error).message);
        }
    }

    return newFailCount;
}

/**
 * 영구 제외로 넘어간 차량을 그 기관의 **관리자에게** 알린다.
 *
 * 직원이 아니라 관리자만 받는 이유: 복구는 차량 설정(캘린더 ID·공유 재설정)에서만 할 수
 * 있고 그 화면은 관리자 전용이다. 전 직원에게 보내면 고칠 수 없는 사람들에게 알림만 쌓인다.
 *
 * 한 번만 보낸다(`calendarSyncDisabledNotifiedAt`). 이 표식은 운영자가 "이 기관은 이미
 * 통지됐는가"를 확인하는 근거도 된다.
 */
async function notifyOrgCalendarDisabled(vehicleId: string): Promise<void> {
    const db = getFirestore();
    const snap = await db.collection("vehicles").doc(vehicleId).get();
    const vehicle = snap.data();
    if (!vehicle) return;

    // 이미 알렸다 — 동시 실행으로 두 경로가 같은 순간을 넘겨도 두 번 보내지 않는다.
    if (vehicle.calendarSyncDisabledNotifiedAt) return;

    const organizationId = (vehicle.organizationId as string) || "";
    if (!organizationId) return;

    // 캘린더 기능을 끈 기관에는 알릴 것이 없다 — 애초에 동기화가 돌지 않는다.
    const orgSnap = await db.collection("organizations").doc(organizationId).get();
    if (!orgSnap.exists || orgSnap.data()?.googleCalendarEnabled === false) return;

    const adminsSnap = await db.collection("users")
        .where("organizationId", "==", organizationId)
        .where("role", "==", "admin")
        .get();
    if (adminsSnap.empty) return;

    const vehicleName = (vehicle.displayName as string) || "차량";
    const reason = (vehicle.calendarSyncLastFailReason as CalendarFailReason) || "other";
    const title = "⚠️ 구글 캘린더 동기화가 중단되었습니다";
    const message =
        `'${vehicleName}' 차량의 캘린더 동기화가 반복 실패로 중단되었습니다. ${REASON_GUIDE[reason]} ` +
        `차량 관리 화면의 '동기화 실패' 배지를 눌러 원인을 진단하고 복구할 수 있습니다.`;

    // sendNotification은 messaging까지 끌고 오는 무거운 모듈이라 필요한 순간에만 부른다
    // (calendarSync의 googleapis와 같은 이유). 순환 참조도 함께 피한다.
    const { createInAppNotification } = await import("../alimtalk/sendNotification");
    await Promise.allSettled(
        adminsSnap.docs.map((d) =>
            createInAppNotification(d.id, "calendar_sync_disabled", title, message, organizationId),
        ),
    );

    await db.collection("vehicles").doc(vehicleId).update({
        calendarSyncDisabledNotifiedAt: FieldValue.serverTimestamp(),
    });

    console.log(`[calendarFailTracking] 캘린더 동기화 중단을 기관 관리자 ${adminsSnap.size}명에게 알림: ${vehicleId}`);
}

/**
 * 동기화 성공 시 실패 카운트를 0으로 리셋한다.
 * (호출 측에서 failCount > 0 일 때만 호출하여 불필요한 쓰기를 피한다.)
 *
 * 사유·통지 표식도 함께 지운다. 남겨 두면 지난 실패의 사유가 복구된 차량에 계속 붙어
 * 있고, 통지 표식이 남아 다음에 다시 끊겼을 때 기관에 알리지 못한다.
 */
export async function resetCalendarFailure(vehicleId: string): Promise<void> {
    await getFirestore().collection("vehicles").doc(vehicleId).update({
        calendarSyncFailCount: 0,
        calendarSyncLastFailReason: FieldValue.delete(),
        calendarSyncLastFailStatus: FieldValue.delete(),
        calendarSyncDisabledNotifiedAt: FieldValue.delete(),
    });
}
