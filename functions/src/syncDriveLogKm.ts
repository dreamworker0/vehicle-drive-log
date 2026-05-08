import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { captureError } from "./sentry";
import { recordHeartbeat } from "./helpers";

const db = getFirestore();

/** 
 * 특정 시점 이후에 같은 차량의 운행기록이 존재하는지 확인 (Admin SDK 버전)
 */
async function hasLaterDriveLog(orgId: string, vehicleId: string, afterTimestamp: Date): Promise<boolean> {
    const q = db.collection('driveLogs')
        .where('organizationId', '==', orgId)
        .where('vehicleId', '==', vehicleId)
        .where('timestamp', '>', afterTimestamp)
        .limit(1);
    const snap = await q.get();
    return !snap.empty;
}

/**
 * 소급 입력/수정 시 같은 차량의 이후 모든 운행기록 startKm을 연쇄적으로 자동 업데이트
 * (Admin SDK 버전)
 */
async function syncNextLogStartKm(orgId: string, vehicleId: string, afterDate: Date, newStartKm: number) {
    let currentAfterDate = afterDate;
    let carryKm = newStartKm; 
    let chainCount = 0;
    const MAX_CHAIN = 20;

    while (chainCount < MAX_CHAIN) {
        const q = db.collection('driveLogs')
            .where('organizationId', '==', orgId)
            .where('vehicleId', '==', vehicleId)
            .where('timestamp', '>', currentAfterDate)
            .orderBy('timestamp', 'asc')
            .limit(1);
        const snap = await q.get();
        if (snap.empty) break;

        const nextDoc = snap.docs[0];
        const nextData = nextDoc.data();
        const oldStartKm = nextData.startKm;

        // startKm이 이미 일치하면 연쇄 중단
        if (oldStartKm === carryKm) break;

        await nextDoc.ref.update({
            startKm: carryKm,
            editedAt: FieldValue.serverTimestamp(),
        });

        // 다음 연쇄: 현재 기록의 endKm → 그 다음 기록의 startKm
        carryKm = nextData.endKm ?? carryKm;
        currentAfterDate = nextData.timestamp instanceof Date 
            ? nextData.timestamp 
            : nextData.timestamp.toDate();
        chainCount++;
    }
}

/**
 * 운행일지 생성 시 부수효과 처리 (currentKm 갱신 및 startKm 연쇄 동기화)
 */
export const onDriveLogCreated = onDocumentCreated(
    { document: "driveLogs/{logId}", region: "asia-northeast3", memory: "256MiB" },
    async (event) => {
        const snap = event.data;
        if (!snap) return;

        const data = snap.data();
        const logId = event.params.logId;

        try {
            const orgId = data.organizationId;
            const vehId = data.vehicleId;
            const ts = data.timestamp instanceof Date ? data.timestamp : data.timestamp?.toDate();
            const endKm = data.endKm;
            const startKm = data.startKm;
            const distance = data.distance;
            const isRetro = data.isRetroactive === true;

            if (!orgId || !vehId || !ts || endKm == null) return;

            // 차량 누적 Km 갱신 (Race Condition 방어용 증분 업데이트)
            const isEffectivelyRetroactive = isRetro || await hasLaterDriveLog(orgId, vehId, ts);

            if (!isEffectivelyRetroactive) {
                let distanceToAdd = 0;
                if (distance != null) {
                    distanceToAdd = distance;
                } else if (startKm != null && endKm != null) {
                    distanceToAdd = endKm - startKm;
                }

                if (distanceToAdd > 0) {
                    await db.collection("vehicles").doc(vehId).update({
                        currentKm: FieldValue.increment(distanceToAdd),
                    });
                }
            }

            // 다음 기록의 startKm 자동 연동 (소급이든 아니든 항상 시도)
            await syncNextLogStartKm(orgId, vehId, ts, endKm);

            await recordHeartbeat("onDriveLogCreated");
        } catch (error) {
            console.error('[onDriveLogCreated] km 동기화 오류:', error);
            captureError(error, { context: 'onDriveLogCreated', logId });
        }
    }
);

/**
 * 운행일지 수정 시 부수효과 처리 (currentKm 차분 갱신 및 startKm 연쇄 동기화)
 */
export const onDriveLogUpdated = onDocumentUpdated(
    { document: "driveLogs/{logId}", region: "asia-northeast3", memory: "256MiB" },
    async (event) => {
        const beforeSnap = event.data?.before;
        const afterSnap = event.data?.after;

        if (!beforeSnap || !afterSnap) return;

        const oldData = beforeSnap.data();
        const data = afterSnap.data();
        const logId = event.params.logId;

        try {
            const orgId = data.organizationId || oldData.organizationId;
            const vehId = data.vehicleId || oldData.vehicleId;
            const tsRaw = data.timestamp || oldData.timestamp;
            const ts = tsRaw instanceof Date ? tsRaw : tsRaw?.toDate();
            const isRetro = data.isRetroactive !== undefined ? data.isRetroactive : oldData.isRetroactive;

            if (data.endKm !== undefined && vehId && orgId && ts) {
                // 이전 endKm과 현재 endKm이 동일하다면 부수효과를 실행할 필요가 없음
                // (다만 startKm이 바뀌는 등의 시나리오는 distance로 잡거나 앞 기록에서 파급됨)
                if (data.endKm === oldData.endKm && data.startKm === oldData.startKm && data.distance === oldData.distance) {
                    return; // 주요 마일리지 필드 변경 없음
                }

                const isRetroactive = isRetro || await hasLaterDriveLog(orgId, vehId, ts);

                if (!isRetroactive) {
                    if (oldData.endKm !== undefined) {
                        const distanceDiff = data.endKm - oldData.endKm;
                        if (distanceDiff !== 0) {
                            await db.collection("vehicles").doc(vehId).update({
                                currentKm: FieldValue.increment(distanceDiff),
                            });
                        }
                    } else {
                        // 기존 값이 없었다면 안전하게 절대값으로 갱신
                        await db.collection("vehicles").doc(vehId).update({
                            currentKm: data.endKm,
                        });
                    }
                }

                // endKm 변경 시 다음 기록의 startKm 자동 연동
                if (data.endKm !== oldData.endKm) {
                    await syncNextLogStartKm(orgId, vehId, ts, data.endKm);
                }
            }

            await recordHeartbeat("onDriveLogUpdated");
        } catch (error) {
            console.error('[onDriveLogUpdated] km 동기화 오류:', error);
            captureError(error, { context: 'onDriveLogUpdated', logId });
        }
    }
);
