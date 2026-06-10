import { getFirestore } from "firebase-admin/firestore";

export async function dailyAggregation(targetMonth: string) {
    const db = getFirestore();
    const orgsSnap = await db.collection("organizations").get();

    for (const orgDoc of orgsSnap.docs) {
        const orgId = orgDoc.id;

        // 월간 운행일지 쿼리 (단순 카운트용, startAt/endAt 필터 가능하지만 지금은 organizationId로 필터링)
        const driveLogsSnap = await db.collection("driveLogs")
            .where("organizationId", "==", orgId)
            // .where("date", ">=", `${targetMonth}-01`)
            // .where("date", "<=", `${targetMonth}-31`)
            .get();

        const fuelLogsSnap = await db.collection("fuelLogs")
            .where("organizationId", "==", orgId)
            .get();

        let fuelCost = 0;
        let tollCost = 0;

        fuelLogsSnap.forEach((doc) => {
            const data = doc.data();
            if (typeof data.amount === 'number') {
                fuelCost += data.amount;
            }
            if (typeof data.toll === 'number') {
                tollCost += data.toll;
            }
        });

        const statsRef = db.doc(`orgStats/${orgId}/monthly/${targetMonth}`);
        await statsRef.set({
            monthlyTotal: {
                count: driveLogsSnap.size,
            },
            costStats: {
                fuelCost,
                tollCost,
            },
            updatedAt: new Date().toISOString()
        }, { merge: true });
    }
}
