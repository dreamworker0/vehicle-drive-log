import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getKSTMonthKey } from "../../utils/kstDate";

/**
 * 소급 입력·수정·삭제로 **다시 집계해야 하는 지난달**을 표시한다.
 *
 * 야간 집계(`runDailyAggregation`)는 이번 달과, 월초(유예일까지)에는 막 끝난 달만 다시 계산한다.
 * 그 밖의 달에 기록이 들어오거나 고쳐지면 분석 화면(`orgStats/{orgId}/monthly/{YYYY-MM}`)이
 * 끝내 옛 숫자로 남았다 — 영수증을 몰아서 늦게 입력하는 기관이 흔한데도.
 *
 * 표시는 `orgStats/{orgId}` 문서의 `staleMonths` 배열에 남기고, 다음 야간 집계가 그 달을 다시
 * 계산한 뒤 지운다. 매일 전월을 통째로 다시 읽는 것(하룻밤 약 4,000 read)보다 훨씬 싸다 —
 * 실제로 바뀐 (기관, 달)만 다시 읽는다.
 */

/** 몇 달 전까지 표시하나 — 분석 화면의 가장 긴 기간(1년)을 덮는다. 더 오래된 달(보존 기한 정리 등)은 건드리지 않는다. */
export const STALE_LOOKBACK_MONTHS = 12;
/** 한 기관이 하룻밤에 다시 집계하는 표시 달의 상한 — 넘치면 다음 밤으로 미룬다(표시는 남는다). */
export const MAX_STALE_MONTHS_PER_RUN = 6;

const MONTH_KEY = /^\d{4}-\d{2}$/;

/** 'YYYY-MM'을 n달 옮긴다 (음수는 과거) */
export function shiftMonthKey(monthKey: string, n: number): string {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 표시해 둘 달만 고른다 — 이번 달은 매일 밤 집계하므로 빼고, 1년보다 오래된 달도 뺀다.
 * 막 끝난 달은 유예일 안이면 어차피 다시 집계되지만, 표시해 두어도 해가 없다(그 밤에 지운다).
 */
export function pickStaleMonths(keys: ReadonlyArray<string | null | undefined>, now: Date = new Date()): string[] {
    const current = getKSTMonthKey(now);
    const oldest = shiftMonthKey(current, -STALE_LOOKBACK_MONTHS);
    const out = new Set<string>();
    for (const k of keys) {
        if (typeof k === "string" && MONTH_KEY.test(k) && k < current && k >= oldest) out.add(k);
    }
    return [...out].sort();
}

/**
 * 운행일지 트리거가 부른다. 표시할 달이 없으면 아무것도 쓰지 않는다(대부분의 기록은 이번 달이다).
 * 실패해도 트리거를 멈추지 않는다 — 표시는 부가 기능이고, 놓치면 숫자가 예전처럼 남을 뿐이다.
 */
export async function markStaleMonths(
    orgId: string | undefined,
    keys: ReadonlyArray<string | null | undefined>,
    now: Date = new Date(),
): Promise<void> {
    const months = pickStaleMonths(keys, now);
    if (!orgId || months.length === 0) return;
    try {
        await getFirestore().collection("orgStats").doc(orgId)
            .set({ staleMonths: FieldValue.arrayUnion(...months) }, { merge: true });
    } catch (error) {
        console.error(`[markStaleMonths] 재집계 표시 실패 (${orgId}: ${months.join(",")}):`, error);
    }
}
