import { getFirestore } from "firebase-admin/firestore";

/**
 * 한 번의 실행 안에서 기관 문서 읽기를 모으는 캐시.
 *
 * 역동기화(`syncCalendarToApp`)는 차량을 순회하며 차량마다 이 함수를 부르는데,
 * 한 기관에 차량이 여러 대면 **같은 기관 문서를 대수만큼 다시 읽는다**. 스케줄이
 * 평일 06~22시 30분 주기(하루 34회)라 이 중복은 기관 수 × 차량 대수로 누적된다.
 *
 * 모듈 전역 캐시로 두지 않는 이유: 인스턴스가 살아 있는 동안 값이 굳어, 관리자가
 * 캘린더 연동을 끈 뒤에도 동기화가 계속 돈다. 호출자가 실행 단위로 Map을 만들어
 * 넘기면 그 실행이 끝나는 순간 캐시도 사라져 이 위험이 없다.
 */
export type OrgCalendarFlagCache = Map<string, boolean>;

/** 기존 기관 호환을 위해 명시적 false일 때만 Google 캘린더 동기화를 끈다. */
export async function isGoogleCalendarEnabled(
    organizationId: string | undefined,
    cache?: OrgCalendarFlagCache,
): Promise<boolean> {
    if (!organizationId) return false;

    const cached = cache?.get(organizationId);
    if (cached !== undefined) return cached;

    // getFirestore()는 initializeApp 이후에만 유효하므로 함수 내부에서 지연 호출한다.
    const orgSnap = await getFirestore().collection("organizations").doc(organizationId).get();
    const enabled = orgSnap.exists && orgSnap.data()?.googleCalendarEnabled !== false;

    cache?.set(organizationId, enabled);
    return enabled;
}
