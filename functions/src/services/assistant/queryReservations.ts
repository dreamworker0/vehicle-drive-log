/**
 * queryReservations — 기관·날짜 기준 예약 현황을 메신저용 텍스트로 요약
 *
 * 플랫폼 독립 코어. 기존 복합 인덱스 reservations(organizationId, date) 사용.
 */
import { getFirestore } from "firebase-admin/firestore";

const db = getFirestore();

const STATUS_LABELS: Record<string, string> = {
    pending: "승인 대기",
    reserved: "예약 확정",
    in_use: "운행 중",
    in_progress: "운행 중",
    completed: "운행 완료",
};

/** 해당 기관·날짜의 예약을 조회해 요약 텍스트를 만든다 (취소·반려 제외) */
export async function buildReservationSummary(organizationId: string, date: string): Promise<string> {
    const snap = await db.collection("reservations")
        .where("organizationId", "==", organizationId)
        .where("date", "==", date)
        .get();

    const items = snap.docs
        .map((doc) => doc.data())
        .filter((r) => r.status !== "cancelled" && r.status !== "rejected")
        .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

    if (items.length === 0) {
        return `📅 ${date} 예약이 없습니다.`;
    }

    const lines = items.map((r) => {
        const vehicle = r.vehicleName || "차량 미상";
        const who = r.reservedByName ? ` — ${r.reservedByName}` : "";
        const dest = r.destination ? ` (${r.destination})` : "";
        const label = STATUS_LABELS[r.status] || r.status;
        return `• ${r.startTime}~${r.endTime} ${vehicle}${who}${dest} [${label}]`;
    });

    return `📅 ${date} 예약 현황 (${items.length}건)\n${lines.join("\n")}`;
}
