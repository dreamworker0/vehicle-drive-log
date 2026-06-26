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

/** Google Calendar API의 캘린더 부재/권한 오류(404·403) 여부 */
export function isCalendarAuthError(err: unknown): boolean {
    const msg = (err as Error)?.message || "";
    return msg.includes("Not Found") || msg.includes("404") || msg.includes("403");
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
 * @returns 증가된 새 failCount
 */
export async function recordCalendarFailure(vehicleId: string, currentFailCount: number): Promise<number> {
    const newFailCount = currentFailCount + 1;
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
