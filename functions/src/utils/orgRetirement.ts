/**
 * orgRetirement — "이 기관은 해지되어 파기 중인가"를 삭제 트리거가 묻는 곳
 *
 * 기관 파기(purgeOrganizationData)는 운행일지·예약·충전 기록을 수백~수천 건 지운다. 그 삭제마다
 * 트리거가 깨어나 **거래를 되돌리려** 든다 — 하이패스 사용액 환불, 차량 누적 km 차감, 구글
 * 캘린더 일정 삭제. 파기는 역사를 덜어내는 일이지 거래를 되돌리는 일이 아니다(보존 기한 정리를
 * isBeyondRetention으로 거르는 것과 같은 이유). 게다가 차량·카드가 먼저 지워지면 그 보정이
 * NOT_FOUND로 실패해 건마다 Sentry·Discord 알림이 쏟아진다.
 *
 * 판정: 기관 문서가 **없거나** `status: "deleted"`이면 해지된 기관이다. 파기는 기관 문서를
 * 맨 마지막에 지우므로, 트리거가 늦게 돌아도 둘 중 하나에 걸린다. 해지 30일 유예 중에는
 * 소속 사용자가 모두 지워진 상태라 정상 삭제가 일어나지 않는다.
 *
 * **판정 실패는 "해지 아님"으로 둔다(fail-open).** 이 가드가 정상 기관의 환불·km 보정을
 * 막는 쪽이 파기 중 알림 몇 건보다 나쁘다.
 */
import { getFirestore } from "firebase-admin/firestore";

/** 같은 인스턴스에서 파기 중 트리거가 몰릴 때 기관 문서를 매번 읽지 않도록 잠깐 기억한다 */
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { retired: boolean; at: number }>();

export async function isOrgRetired(orgId: unknown): Promise<boolean> {
    if (typeof orgId !== "string" || orgId === "") return false;

    const hit = cache.get(orgId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.retired;

    try {
        const snap = await getFirestore().collection("organizations").doc(orgId).get();
        const retired = !snap.exists || snap.data()?.status === "deleted";
        cache.set(orgId, { retired, at: Date.now() });
        return retired;
    } catch (err) {
        console.warn(`[isOrgRetired] 기관 상태 확인 실패 — 해지 아님으로 진행 (${orgId}):`, (err as Error).message);
        return false;
    }
}

/** 테스트 전용 — 인스턴스 캐시를 비운다 */
export function _resetOrgRetirementCache(): void {
    cache.clear();
}
