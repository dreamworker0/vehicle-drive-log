import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { getKSTMonthKey, toKSTDate } from "../../utils/kstDate";

const db = getFirestore();

export const dailyAggregation = onSchedule(
    {
        schedule: "0 2 * * *",
        timeZone: "Asia/Seoul",
        region: "asia-northeast3",
        timeoutSeconds: 540,
        memory: "512MiB",
    },
    async (event) => {
        logger.info("[dailyAggregation] 일일 배치 집계 시작");

        // 배치 실행 시간이 새벽 02:00이므로, 전날 기준의 달을 대상으로 처리 (1일 새벽 실행 시 전월 집계)
        const targetDate = toKSTDate(new Date(Date.now() - 3 * 60 * 60 * 1000));
        const yearMonth = getKSTMonthKey(targetDate);
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth(); // 0-11
        
        // KST 기준 월의 시작과 끝 (UTC Date 객체로 변환하여 Firestore timestamp 비교에 사용)
        const startOfMonth = new Date(Date.UTC(year, month, 1, -9, 0, 0, 0));
        const startOfNextMonth = new Date(Date.UTC(year, month + 1, 1, -9, 0, 0, 0));

        try {
            const orgsSnap = await db.collection("organizations").get();

            for (const orgDoc of orgsSnap.docs) {
                const orgId = orgDoc.id;

                // 1. 유저 및 차량 메타데이터 캐싱
                const [usersSnap, vehiclesSnap] = await Promise.all([
                    db.collection("users").where("organizationId", "==", orgId).get(),
                    db.collection("vehicles").where("organizationId", "==", orgId).get(),
                ]);

                const userMap = new Map<string, string>();
                usersSnap.forEach((d) => userMap.set(d.id, d.data().name || "알 수 없음"));

                const vehicleMap = new Map<string, string>();
                vehiclesSnap.forEach((d) => vehicleMap.set(d.id, d.data().name || d.data().number || "알 수 없음"));

                // 2. 통계 데이터 초기화
                const monthlyTotal = { count: 0, distance: 0 };
                const driverStats: Record<string, { name: string; count: number; distance: number }> = {};
                const vehicleStats: Record<string, { name: string; usedDays: number; count: number }> = {};
                const heatmap: Record<string, Record<string, number>> = {};
                const vehicleDates: Record<string, Set<string>> = {};
                const costStats = { fuelCost: 0, hipassCost: 0, maintenanceCost: 0 };

                // 3. 운행일지 데이터 집계
                const driveLogsSnap = await db.collection("driveLogs")
                    .where("organizationId", "==", orgId)
                    .where("timestamp", ">=", startOfMonth)
                    .where("timestamp", "<", startOfNextMonth)
                    .get();

                driveLogsSnap.forEach((docSnap) => {
                    const data = docSnap.data();
                    const distance = data.distance ?? ((data.endKm || 0) - (data.startKm || 0));
                    const validDistance = distance > 0 ? distance : 0;
                    
                    monthlyTotal.count += 1;
                    monthlyTotal.distance += validDistance;

                    const uid = data.uid || data.driverId;
                    if (uid) {
                        if (!driverStats[uid]) {
                            driverStats[uid] = { name: data.driverName || userMap.get(uid) || "알 수 없음", count: 0, distance: 0 };
                        }
                        driverStats[uid].count += 1;
                        driverStats[uid].distance += validDistance;
                    }

                    const vehId = data.vehicleId;
                    if (vehId) {
                        if (!vehicleStats[vehId]) {
                            vehicleStats[vehId] = { name: data.vehicleName || vehicleMap.get(vehId) || "알 수 없음", usedDays: 0, count: 0 };
                            vehicleDates[vehId] = new Set<string>();
                        }
                        vehicleStats[vehId].count += 1;
                        
                        const ts = data.timestamp?.toDate();
                        if (ts) {
                            const kstTs = toKSTDate(ts);
                            const dateStr = `${kstTs.getFullYear()}-${String(kstTs.getMonth() + 1).padStart(2, "0")}-${String(kstTs.getDate()).padStart(2, "0")}`;
                            vehicleDates[vehId].add(dateStr);
                            
                            const dayOfWeek = String(kstTs.getDay());
                            const hour = String(kstTs.getHours());
                            if (!heatmap[dayOfWeek]) heatmap[dayOfWeek] = {};
                            if (!heatmap[dayOfWeek][hour]) heatmap[dayOfWeek][hour] = 0;
                            heatmap[dayOfWeek][hour] += 1;
                        }
                    }
                });

                // usedDays 계산
                for (const vehId in vehicleDates) {
                    vehicleStats[vehId].usedDays = vehicleDates[vehId].size;
                }

                // 4. 비용(주유, 하이패스, 정비) 데이터 집계
                const datePrefixStart = `${yearMonth}-01`;
                const datePrefixEnd = `${yearMonth}-31`;

                const [fuelSnap, hipassSnap, maintenanceSnap] = await Promise.all([
                    db.collection("fuelLogs")
                        .where("organizationId", "==", orgId)
                        .where("date", ">=", datePrefixStart)
                        .where("date", "<=", datePrefixEnd)
                        .get(),
                    db.collection("hipassCharges")
                        .where("organizationId", "==", orgId)
                        .where("date", ">=", datePrefixStart)
                        .where("date", "<=", datePrefixEnd)
                        .get(),
                    db.collection("maintenanceRecords")
                        .where("organizationId", "==", orgId)
                        .where("date", ">=", datePrefixStart)
                        .where("date", "<=", datePrefixEnd)
                        .get(),
                ]);

                fuelSnap.forEach(d => costStats.fuelCost += (Number(d.data().amount) || Number(d.data().cost) || 0));
                hipassSnap.forEach(d => costStats.hipassCost += (Number(d.data().amount) || Number(d.data().chargeAmount) || 0));
                maintenanceSnap.forEach(d => costStats.maintenanceCost += (Number(d.data().cost) || 0));

                // 5. 스키마 병합 및 저장
                const orgStatsRef = db.collection("orgStats").doc(orgId).collection("monthly").doc(yearMonth);
                await orgStatsRef.set({
                    yearMonth,
                    updatedAt: FieldValue.serverTimestamp(),
                    monthlyTotal,
                    driverStats,
                    vehicleStats,
                    heatmap,
                    costStats
                }, { merge: true });
                
                logger.info(`[dailyAggregation] ${orgId} - ${yearMonth} 집계 완료`);
            }
            logger.info("[dailyAggregation] 일일 배치 집계 전체 완료");
        } catch (error) {
            logger.error("[dailyAggregation] 오류 발생:", error);
        }
    }
);
