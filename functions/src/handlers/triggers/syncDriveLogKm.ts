import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { captureError } from "../../core/sentry";
import { recordHeartbeat } from "../../utils/helpers";
import { handleStatsOnCreate, handleStatsOnUpdate, handleStatsOnDelete } from "../../services/statistics/updateAggregatedStats";
import { resolveDriveLogConflict } from "../sync/conflictResolver";

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
 *
 * @remarks 단위 테스트(syncDriveLogKm.test.ts)를 위해 export한다.
 */
export async function syncNextLogStartKm(orgId: string, vehicleId: string, afterDate: Date, newStartKm: number) {
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

        const diff = carryKm - oldStartKm;
        let newEndKm = (nextData.endKm ?? carryKm) + diff;

        // [방어 코드] 주행거리가 마이너스로 전파되는 것 원천 차단
        carryKm = Math.max(0, carryKm);
        newEndKm = Math.max(0, newEndKm);

        await nextDoc.ref.update({
            startKm: carryKm,
            endKm: newEndKm,
            editedAt: FieldValue.serverTimestamp(),
        });

        // 다음 연쇄: 현재 기록의 새롭게 계산된 endKm → 그 다음 기록의 startKm
        carryKm = newEndKm;
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
                    // 차량이 운행일지의 기관 소속인지 검증 후 갱신 (교차 테넌트 currentKm 오염 차단 — 2026-07-04 감사 N3)
                    const vehSnap = await db.collection("vehicles").doc(vehId).get();
                    if (vehSnap.exists && vehSnap.data()?.organizationId === orgId) {
                        await db.collection("vehicles").doc(vehId).update({
                            currentKm: FieldValue.increment(distanceToAdd),
                        });
                    } else {
                        console.warn(`[onDriveLogCreated] 차량 org 불일치 — currentKm 갱신 건너뜀: veh=${vehId}, org=${orgId}`);
                    }
                }
            }

            // 다음 기록의 startKm 자동 연동 (소급이든 아니든 항상 시도)
            await syncNextLogStartKm(orgId, vehId, ts, endKm);

            // [통합 트리거] 기관 통계 증분 업데이트
            await handleStatsOnCreate(orgId, data);

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
            // [오프라인 충돌 방어] LWW 기반: 들어온 데이터가 더 과거에 수정된 데이터면 롤백하고 종료
            const isConflict = await resolveDriveLogConflict(afterSnap.ref, oldData, data);
            if (isConflict) return;

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

            // [통합 트리거] 기관 통계 차분 업데이트
            const finalOrgId = data.organizationId || oldData.organizationId;
            if (finalOrgId) {
                await handleStatsOnUpdate(finalOrgId, oldData, data);
            }

            await recordHeartbeat("onDriveLogUpdated");
        } catch (error) {
            console.error('[onDriveLogUpdated] km 동기화 오류:', error);
            captureError(error, { context: 'onDriveLogUpdated', logId });
        }
    }
);

/**
 * 운행일지 삭제 시 부수효과 처리 (currentKm 차감 및 startKm 연쇄 동기화)
 */
export const onDriveLogDeleted = onDocumentDeleted(
    { document: "driveLogs/{logId}", region: "asia-northeast3", memory: "256MiB" },
    async (event) => {
        const snap = event.data;
        if (!snap) return;

        const data = snap.data();
        const logId = event.params.logId;

        try {
            const orgId = data.organizationId;
            const vehId = data.vehicleId;
            const tsRaw = data.timestamp;
            const ts = tsRaw instanceof Date ? tsRaw : tsRaw?.toDate();
            const endKm = data.endKm;
            const startKm = data.startKm;
            const distance = data.distance;

            if (!orgId || !vehId || !ts) return;

            // 최신 기록 삭제 여부 판별 (자기 자신은 삭제되었으므로 본인 이후의 기록이 있는지 확인)
            const isEffectivelyRetroactive = await hasLaterDriveLog(orgId, vehId, ts);

            if (!isEffectivelyRetroactive) {
                // 가장 최근 기록이 삭제된 경우, 해당 거리만큼 차량 누적 Km 차감 롤백
                let distanceToSubtract = 0;
                if (distance != null) {
                    distanceToSubtract = distance;
                } else if (startKm != null && endKm != null) {
                    distanceToSubtract = endKm - startKm;
                }

                if (distanceToSubtract > 0) {
                    await db.collection("vehicles").doc(vehId).update({
                        currentKm: FieldValue.increment(-distanceToSubtract),
                    });
                }
            } else {
                // 소급(중간) 기록이 삭제된 경우: 
                // 삭제된 기록 이전의 마지막 운행일지를 찾아서 그 endKm부터 이후 기록들의 startKm을 연동
                const prevLogSnap = await db.collection('driveLogs')
                    .where('organizationId', '==', orgId)
                    .where('vehicleId', '==', vehId)
                    .where('timestamp', '<', ts)
                    .orderBy('timestamp', 'desc')
                    .limit(1)
                    .get();

                let prevEndKm = 0;
                if (!prevLogSnap.empty) {
                    prevEndKm = prevLogSnap.docs[0].data().endKm ?? 0;
                } else {
                    // 이전 기록이 아예 없다면 삭제된 기록의 startKm을 시작점으로 사용 (또는 0)
                    prevEndKm = startKm ?? 0; 
                }

                await syncNextLogStartKm(orgId, vehId, ts, prevEndKm);
            }

            // [통합 트리거] 기관 통계 차감 업데이트
            if (orgId) {
                await handleStatsOnDelete(orgId, data);
            }

            await recordHeartbeat("onDriveLogDeleted");
        } catch (error) {
            console.error('[onDriveLogDeleted] km 동기화(삭제) 오류:', error);
            captureError(error, { context: 'onDriveLogDeleted', logId });
        }
    }
);
