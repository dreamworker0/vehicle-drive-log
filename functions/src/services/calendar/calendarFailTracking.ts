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

/**
 * 캘린더 인증/부재 오류 시 실패 카운트를 1 증가시키고 마지막 실패 시각을 기록한다.
 * 카운터는 MAX_FAIL_COUNT를 넘지 않도록 캡한다(영구제외 임계). 일부 경로가 백오프 가드를
 * 빠뜨려도 카운터가 무한 증가(예: 192회)하지 않도록 하는 방어적 불변식이다.
 * @returns 증가된(캡 적용) 새 failCount
 */
export async function recordCalendarFailure(vehicleId: string, currentFailCount: number): Promise<number> {
    const newFailCount = Math.min(currentFailCount + 1, MAX_FAIL_COUNT);
    await getFirestore().collection("vehicles").doc(vehicleId).update({
        calendarSyncFailCount: newFailCount,
        calendarSyncLastFailAt: FieldValue.serverTimestamp(),
    });
    return newFailCount;
}

/**
 * 동기화 성공 시 실패 카운트를 0으로 리셋한다.
 * (호출 측에서 failCount > 0 일 때만 호출하여 불필요한 쓰기를 피한다.)
 */
export async function resetCalendarFailure(vehicleId: string): Promise<void> {
    await getFirestore().collection("vehicles").doc(vehicleId).update({
        calendarSyncFailCount: 0,
    });
}
