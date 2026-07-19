/**
 * cancelReservation — 취소 대상 예약 후보 조회 (플랫폼 독립)
 *
 * 자연어에서 "어떤 예약을 취소할지" 특정하기 위해, 본인이 예약한 진행 예정 건을
 * 기관·소유자 스코프로 조회한다. 조직 격리·소유자 필터는 쿼리 레벨에서 강제하고,
 * 실제 취소 시 cancelReservationTx가 다시 검증한다(방어 심층화).
 */
import { getFirestore } from "firebase-admin/firestore";
import { getSeoulNow } from "./parseIntent";

const db = getFirestore();

export interface CancelCandidate {
    id: string;
    vehicleId: string;
    vehicleName: string;
    date: string;
    startTime: string;
    endTime: string;
}

export interface CancelFilters {
    date: string | null;
    vehicleId: string | null;
    startTime: string | null;
}

/** 취소 가능한 상태 (진행 예정 예약만) */
const CANCELABLE_STATUSES = new Set(["pending", "reserved"]);

/** 후보 과다 방지 상한 — 되묻기 목록이 지나치게 길어지지 않게 한다 */
const MAX_CANDIDATES = 10;

/**
 * 본인(uid)이 예약한 취소 가능 후보를 조회한다.
 * @param orgId 기관 ID (조직 격리)
 * @param uid   요청자 UID (본인 예약만)
 * @param filters 날짜·차량·시작시간 단서 (있으면 좁힌다). 날짜가 없으면 오늘 이후 예정 건.
 */
export async function findCancelCandidates(
    orgId: string,
    uid: string,
    filters: CancelFilters
): Promise<CancelCandidate[]> {
    let q = db.collection("reservations")
        .where("organizationId", "==", orgId)
        .where("reservedByUid", "==", uid);

    if (filters.date) {
        q = q.where("date", "==", filters.date);
    } else {
        // 날짜 단서가 없으면 오늘(Asia/Seoul) 이후 예정 건만 (과거 예약 취소는 의미 없음)
        q = q.where("date", ">=", getSeoulNow().date);
    }

    const snap = await q.get();

    type Row = Record<string, unknown> & { id: string };
    let list: Row[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
    list = list.filter((r) => CANCELABLE_STATUSES.has(r.status as string));

    if (filters.vehicleId) {
        list = list.filter((r) => r.vehicleId === filters.vehicleId);
    }
    if (filters.startTime) {
        list = list.filter((r) => r.startTime === filters.startTime);
    }

    return list
        .sort((a, b) =>
            (`${a.date ?? ""}${a.startTime ?? ""}`).localeCompare(`${b.date ?? ""}${b.startTime ?? ""}`)
        )
        .slice(0, MAX_CANDIDATES)
        .map((r) => ({
            id: r.id,
            vehicleId: (r.vehicleId as string) || "",
            vehicleName: (r.vehicleName as string) || "",
            date: (r.date as string) || "",
            startTime: (r.startTime as string) || "",
            endTime: (r.endTime as string) || "",
        }));
}
