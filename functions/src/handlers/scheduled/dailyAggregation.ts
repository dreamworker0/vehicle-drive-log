import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { getKSTMonthKey, toKSTDate } from "../../utils/kstDate";

const db = getFirestore();

/** 단일 (기관, 월) 집계 윈도 */
interface MonthWindow {
    yearMonth: string;         // 'YYYY-MM' (KST)
    startOfMonth: Date;        // KST 1일 00:00의 UTC instant (timestamp 범위 비교용)
    startOfNextMonth: Date;
    datePrefixStart: string;   // 'YYYY-MM-01' (date 문자열 비교용)
    datePrefixEnd: string;     // 'YYYY-MM-31'
}

/**
 * 배치 실행 시점(-3h) 기준 최근 N개월(당월 포함)의 집계 윈도를 최신월부터 반환.
 * Date.UTC(y, m, 1, -9)는 KST 1일 00:00에 해당하는 UTC instant이며 월 오버/언더플로를 자동 처리한다.
 */
function getRecentMonthWindows(recentMonths: number): MonthWindow[] {
    const base = toKSTDate(new Date(Date.now() - 3 * 60 * 60 * 1000));
    const year = base.getFullYear();
    const month = base.getMonth(); // 0-11 (KST)
    const windows: MonthWindow[] = [];
    for (let i = 0; i < recentMonths; i++) {
        const startOfMonth = new Date(Date.UTC(year, month - i, 1, -9, 0, 0, 0));
        const startOfNextMonth = new Date(Date.UTC(year, month - i + 1, 1, -9, 0, 0, 0));
        const yearMonth = getKSTMonthKey(startOfMonth);
        windows.push({
            yearMonth,
            startOfMonth,
            startOfNextMonth,
            datePrefixStart: `${yearMonth}-01`,
            datePrefixEnd: `${yearMonth}-31`,
        });
    }
    return windows;
}

/** orgStats/{orgId}/monthly/{YYYY-MM} 문서의 차량별 통계 값 */
interface VehicleAgg {
    name: string;
    usedDays: number;
    count: number;
    distance: number;          // 차량별 총 주행거리 (연비 계산용)
    fuelCost: number;          // 차량별 총 주유비 (연비 계산용)
    maintenanceCost: number;   // 차량별 총 정비비
    maintenanceCount: number;  // 차량별 정비 횟수
    lastMaintenanceDate: string;
}

/**
 * 단일 (기관, 월) 집계를 orgStats/{orgId}/monthly/{yearMonth}에 저장한다.
 * 소비자(src/lib/firestore/statistics.ts의 mapMonthlyDoc)가 이 스키마를 평탄 MonthlyStat으로 변환한다.
 */
async function aggregateOrgMonth(
    orgId: string,
    win: MonthWindow,
    userMap: Map<string, string>,
    vehicleMap: Map<string, string>,
): Promise<void> {
    const monthlyTotal = { count: 0, distance: 0 };
    const driverStats: Record<string, { name: string; count: number; distance: number }> = {};
    const vehicleStats: Record<string, VehicleAgg> = {};
    const heatmap: Record<string, Record<string, number>> = {};
    const vehicleDates: Record<string, Set<string>> = {};
    const costStats = { fuelCost: 0, hipassCost: 0, maintenanceCost: 0 };
    // 이상 탐지 (월 단위 카운트) — 소비자가 임계값 기반으로 카드 표시
    const anomalies = { weekend: 0, night: 0, overDrive: 0 };
    const driverDayDistance: Record<string, number> = {}; // `${운전자}_${dateStr}` → 거리 합 (1일 과다주행 판정용)

    // 운행 없이 주유/정비만 있는 차량도 정비비 표시를 위해 엔트리를 보장한다
    const ensureVehicle = (vehId: string): VehicleAgg => {
        if (!vehicleStats[vehId]) {
            vehicleStats[vehId] = {
                name: vehicleMap.get(vehId) || "알 수 없음",
                usedDays: 0, count: 0, distance: 0,
                fuelCost: 0, maintenanceCost: 0, maintenanceCount: 0, lastMaintenanceDate: "",
            };
        }
        return vehicleStats[vehId];
    };

    // 1. 운행일지 집계 (운행/거리/운전자/차량/히트맵/이상탐지)
    const driveLogsSnap = await db.collection("driveLogs")
        .where("organizationId", "==", orgId)
        .where("timestamp", ">=", win.startOfMonth)
        .where("timestamp", "<", win.startOfNextMonth)
        .get();

    driveLogsSnap.forEach((docSnap) => {
        const data = docSnap.data();
        const rawDist = data.distance ?? ((data.endKm || 0) - (data.startKm || 0));
        const validDistance = rawDist > 0 ? rawDist : 0;

        monthlyTotal.count += 1;
        monthlyTotal.distance += validDistance;

        // 운전자 통계 — 운행일지의 운전자 식별자는 driverUid
        const uid = data.driverUid;
        const driverName = data.driverName || (uid ? userMap.get(uid) : undefined) || "알 수 없음";
        if (uid) {
            if (!driverStats[uid]) driverStats[uid] = { name: driverName, count: 0, distance: 0 };
            driverStats[uid].count += 1;
            driverStats[uid].distance += validDistance;
        }

        // 타임스탬프 파생 — 히트맵(요일×시간), 이상탐지(주말/심야), 차량 가동일
        const ts = data.timestamp?.toDate?.();
        let dateStr = "";
        if (ts) {
            const kstTs = toKSTDate(ts);
            const dayOfWeek = kstTs.getDay(); // 0=일 ~ 6=토
            const hour = kstTs.getHours();
            dateStr = `${kstTs.getFullYear()}-${String(kstTs.getMonth() + 1).padStart(2, "0")}-${String(kstTs.getDate()).padStart(2, "0")}`;

            const dowKey = String(dayOfWeek);
            const hourKey = String(hour);
            if (!heatmap[dowKey]) heatmap[dowKey] = {};
            heatmap[dowKey][hourKey] = (heatmap[dowKey][hourKey] || 0) + 1;

            if (dayOfWeek === 0 || dayOfWeek === 6) anomalies.weekend += 1;
            if (hour >= 22 || hour < 6) anomalies.night += 1;
        }

        // 차량 통계 (가동일·주행거리)
        const vehId = data.vehicleId;
        if (vehId) {
            const vs = ensureVehicle(vehId);
            if (data.vehicleName) vs.name = data.vehicleName; // 운행일지의 표시명 우선
            vs.count += 1;
            vs.distance += validDistance;
            if (dateStr) {
                if (!vehicleDates[vehId]) vehicleDates[vehId] = new Set<string>();
                vehicleDates[vehId].add(dateStr);
            }
        }

        // 1일 과다주행(200km 초과) — 운전자×일자 버킷 누적
        if (dateStr) {
            const bucketKey = `${uid || driverName}_${dateStr}`;
            driverDayDistance[bucketKey] = (driverDayDistance[bucketKey] || 0) + validDistance;
        }
    });

    for (const vehId in vehicleDates) {
        if (vehicleStats[vehId]) vehicleStats[vehId].usedDays = vehicleDates[vehId].size;
    }
    anomalies.overDrive = Object.values(driverDayDistance).filter((d) => d > 200).length;

    // 2. 비용 집계 (주유·하이패스·정비) — date 문자열 월 범위
    // orderBy("date","desc")로 기존 (organizationId ASC, date DESC) 복합 인덱스를 사용한다.
    // orderBy 없이 범위 필터만 두면 Firestore가 date ASC 인덱스를 요구해 FAILED_PRECONDITION이 난다
    // (정렬은 아래 forEach 집계 결과에 영향 없음).
    const [fuelSnap, hipassSnap, maintenanceSnap] = await Promise.all([
        db.collection("fuelLogs").where("organizationId", "==", orgId)
            .where("date", ">=", win.datePrefixStart).where("date", "<=", win.datePrefixEnd).orderBy("date", "desc").get(),
        db.collection("hipassCharges").where("organizationId", "==", orgId)
            .where("date", ">=", win.datePrefixStart).where("date", "<=", win.datePrefixEnd).orderBy("date", "desc").get(),
        db.collection("maintenanceRecords").where("organizationId", "==", orgId)
            .where("date", ">=", win.datePrefixStart).where("date", "<=", win.datePrefixEnd).orderBy("date", "desc").get(),
    ]);

    // 주유: FuelLog.fuelCost(원) — 조직 합계 + 차량별 연비 계산용 누적
    fuelSnap.forEach((d) => {
        const fd = d.data();
        const cost = Number(fd.fuelCost) || 0;
        costStats.fuelCost += cost;
        if (fd.vehicleId) ensureVehicle(fd.vehicleId).fuelCost += cost;
    });
    // 하이패스: HipassCharge.chargeAmount(원) — 조직 합계
    hipassSnap.forEach((d) => {
        costStats.hipassCost += Number(d.data().chargeAmount) || 0;
    });
    // 정비: MaintenanceRecord.cost — 조직 합계 + 차량별 정비비/횟수/최종일
    maintenanceSnap.forEach((d) => {
        const md = d.data();
        const cost = Number(md.cost) || 0;
        costStats.maintenanceCost += cost;
        if (md.vehicleId) {
            const vs = ensureVehicle(md.vehicleId);
            vs.maintenanceCost += cost;
            vs.maintenanceCount += 1;
            const mdate = (md.date as string) || "";
            if (mdate > vs.lastMaintenanceDate) vs.lastMaintenanceDate = mdate;
        }
    });

    // 3. 저장
    const orgStatsRef = db.collection("orgStats").doc(orgId).collection("monthly").doc(win.yearMonth);
    await orgStatsRef.set({
        yearMonth: win.yearMonth,
        updatedAt: FieldValue.serverTimestamp(),
        monthlyTotal,
        driverStats,
        vehicleStats,
        heatmap,
        costStats,
        anomalies,
    }, { merge: true });
}

/** runDailyAggregation 실행 요약 — 호출자(백필 콜러블 등)가 성공/실패를 인지할 수 있게 반환 */
export interface AggregationSummary {
    orgs: number;       // 전체 기관 수
    processed: number;  // 집계 성공 기관 수
    errors: number;     // 집계 실패 기관 수
    months: string[];   // 집계 대상 월(YYYY-MM)
}

/**
 * 전체 기관의 최근 N개월 운행/비용/이상 통계를 집계해 orgStats/{orgId}/monthly/{YYYY-MM}에 캐싱한다.
 *
 * 통합 야간 배치(dailyNightlyBatch)의 한 단계로 KST 02:00에 실행되며(실행 시각 -3h 기준으로 대상 월 산정),
 * 지각·소급 입력(retroactive) 로그를 반영하기 위해 당월+전월(기본 2개월)을 재집계한다.
 * 과거 월 전체를 소급 교정하려면 더 큰 recentMonths로 1회 호출(백필)하면 된다.
 *
 * 기관별로 오류를 격리해 한 기관 실패가 나머지를 중단시키지 않으며, 실행 요약을 반환한다.
 * 기관 목록 조회 실패 등 치명적 오류는 상위로 전파해 호출자가 실패를 인지하도록 한다.
 */
export async function runDailyAggregation(recentMonths = 2): Promise<AggregationSummary> {
    const windows = getRecentMonthWindows(recentMonths);
    const months = windows.map((w) => w.yearMonth);
    logger.info(`[dailyAggregation] 일일 배치 집계 시작 (최근 ${recentMonths}개월: ${months.join(", ")})`);

    const orgsSnap = await db.collection("organizations").get();
    let processed = 0;
    let errors = 0;

    for (const orgDoc of orgsSnap.docs) {
        const orgId = orgDoc.id;
        try {
            // 유저·차량 메타데이터는 월과 무관하므로 기관당 1회만 로드해 월 루프에서 재사용
            const [usersSnap, vehiclesSnap] = await Promise.all([
                db.collection("users").where("organizationId", "==", orgId).get(),
                db.collection("vehicles").where("organizationId", "==", orgId).get(),
            ]);

            const userMap = new Map<string, string>();
            usersSnap.forEach((u) => userMap.set(u.id, u.data().name || "알 수 없음"));

            const vehicleMap = new Map<string, string>();
            vehiclesSnap.forEach((v) => vehicleMap.set(v.id, v.data().name || v.data().number || "알 수 없음"));

            for (const win of windows) {
                await aggregateOrgMonth(orgId, win, userMap, vehicleMap);
            }
            processed++;
        } catch (err) {
            // 한 기관 실패가 전체 배치를 중단시키지 않도록 격리 (나머지 기관은 계속 집계)
            errors++;
            logger.error(`[dailyAggregation] ${orgId} 집계 실패:`, (err as Error).message);
        }
    }

    const summary: AggregationSummary = { orgs: orgsSnap.size, processed, errors, months };
    logger.info(`[dailyAggregation] 집계 완료 — 기관 ${summary.orgs}, 성공 ${processed}, 실패 ${errors}`);
    return summary;
}
