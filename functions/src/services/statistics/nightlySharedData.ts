/**
 * nightlySharedData — 야간 통계 배치의 두 단계가 함께 쓰는 원본 선로딩
 *
 * `nightlyStatsBatch`는 `runDailyAggregation`(기관 월간 집계)과 `computeAllDashboardStats`
 * (슈퍼관리자 대시보드 캐시)를 한 프로세스에서 이어서 돌린다. 둘은 **같은 원본을 각자 읽었다** —
 * 기관·사용자·차량 전체, 그리고 이번 달 운행일지. 월간 집계는 거기에 기관마다 쿼리 6종을 따로
 * 던져, 결과가 비어도 1 read씩 과금됐다. 2026-09-25 실측으로 이 배치가 새벽 2시 1분 동안
 * 약 2.4만 read를 써서 하루 읽기의 절반을 차지했다.
 *
 * 여기서 한 번만 읽어 두 단계에 넘긴다. 각 함수는 이 인자가 없으면 예전처럼 스스로 읽으므로
 * 콜러블(백필·수동 새로고침)의 동작은 바뀌지 않는다.
 */
import { getFirestore } from "firebase-admin/firestore";

export interface NightlySharedData {
    orgDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    userDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    vehicleDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    /** `timestamp >= driveLogScanStart`인 운행일지 (상한 없음 — 대시보드 스캔과 같은 조건) */
    driveLogDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    driveLogScanStart: Date;
}

/** 두 단계가 필요로 하는 가장 이른 시점부터 운행일지를 읽는다. */
export async function loadNightlySharedData(driveLogScanStart: Date): Promise<NightlySharedData> {
    const db = getFirestore();
    const [orgSnap, userSnap, vehicleSnap, driveLogSnap] = await Promise.all([
        db.collection("organizations").get(),
        db.collection("users").get(),
        db.collection("vehicles").get(),
        db.collection("driveLogs").where("timestamp", ">=", driveLogScanStart).get(),
    ]);
    return {
        orgDocs: orgSnap.docs,
        userDocs: userSnap.docs,
        vehicleDocs: vehicleSnap.docs,
        driveLogDocs: driveLogSnap.docs,
        driveLogScanStart,
    };
}

/** organizationId로 묶는다 (필드가 없는 문서는 버린다 — 기관별 쿼리에도 걸리지 않던 문서다). */
export function groupDataByOrg(
    docs: FirebaseFirestore.QueryDocumentSnapshot[],
): Map<string, FirebaseFirestore.QueryDocumentSnapshot[]> {
    const map = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    for (const d of docs) {
        const orgId = d.data().organizationId;
        if (typeof orgId !== "string" || !orgId) continue;
        const list = map.get(orgId);
        if (list) list.push(d);
        else map.set(orgId, [d]);
    }
    return map;
}
