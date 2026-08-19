/**
 * vehicleStatus — 차량이 지금 예약 가능한 상태인지 판정 (프론트엔드 · Cloud Functions 공용 원본)
 *
 * 같은 판정이 세 곳에 필요하다: 예약 화면(버튼 비활성), Slack 어시스턴트(제안 차단),
 * 그리고 예약 생성 트랜잭션(권위 검증). 규칙이 갈라지면 화면에서는 막히는 차량이
 * 봇으로는 예약되거나, 정비가 끝난 차량이 계속 막힌다 — 실제로 어시스턴트는 `endDate`를
 * 보지 않아 정비 종료일이 지난 차량을 계속 차단하고 있었다.
 *
 * **오늘 날짜는 인자로 받는다.** 프론트엔드는 브라우저 로컬(한국 사용자 기준 KST),
 * Functions는 Asia/Seoul로 계산한 값을 넘긴다. 이 파일이 직접 시간대를 가정하면
 * UTC로 도는 서버에서 하루가 밀린다.
 */

/** 정비 차단 판정에 필요한 최소 형태 */
export interface MaintenanceLike {
    isBlocked?: boolean;
    /** 마지막 차단일(YYYY-MM-DD). 없으면 무기한 차단(수동 해제) */
    endDate?: string | null;
}

/** 퇴역 판정에 필요한 최소 형태 */
export interface RetiredLike {
    isRetired?: boolean;
}

/**
 * 차량이 `todayStr` 시점에 정비로 차단된 상태인가.
 * `endDate` 당일까지 차단하고 그 다음 날부터 자동 해제한다.
 */
export function isVehicleBlockedOn(
    maintenance: MaintenanceLike | null | undefined,
    todayStr: string,
): boolean {
    if (!maintenance?.isBlocked) return false;
    if (!maintenance.endDate) return true;
    return todayStr <= maintenance.endDate;
}

/** 폐차·매각 등으로 목록에서 내린 차량인가. */
export function isVehicleRetired(retired: RetiredLike | null | undefined): boolean {
    return retired?.isRetired === true;
}
