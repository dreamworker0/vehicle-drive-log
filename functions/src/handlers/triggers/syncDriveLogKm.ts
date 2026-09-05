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

/** 한 번의 호출에서 재정합할 최대 문서 수. 초과분은 마지막 문서에 이어받기 표시를 남겨 계속한다. */
const MAX_DOCS_PER_RUN = 1000;
/** 한 번에 조회·커밋하는 페이지 크기 (Firestore 배치 상한 500 이내) */
const PAGE_SIZE = 200;

/** 연쇄 쓰기임을 표시하는 필드 — 이 값이 변한 update는 트리거가 즉시 반환한다(재발동 차단). */
export const KM_SYNC_REV_FIELD = 'kmSyncRev';
/** 상한에 걸려 중단됐음을 마지막 문서에 남기는 표시 — 그 문서의 트리거가 이어받는다. */
export const KM_SYNC_CONTINUE_FIELD = 'kmSyncContinue';

function toDate(value: unknown): Date {
    if (value instanceof Date) return value;
    return (value as { toDate: () => Date }).toDate();
}

export interface KmChainResult {
    /** 실제로 이동시킨 문서 수 */
    processed: number;
    /** 마지막으로 이동한 문서의 endKm 변화량 (차량 currentKm 보정에 사용) */
    lastEndKmDelta: number;
    /** 더 이상 뒤 기록이 없어 정상 종료 — 차량의 최신 기록까지 반영됐다는 뜻 */
    reachedEnd: boolean;
    /** startKm이 이미 일치해 조기 중단 — 이후 기록은 영향이 없다 */
    stoppedConsistent: boolean;
    /** 상한(MAX_DOCS_PER_RUN)에 걸려 중단 — 마지막 문서 트리거가 이어받는다 */
    truncated: boolean;
}

/**
 * 소급 입력/수정 시 같은 차량의 이후 운행기록 startKm/endKm을 연쇄적으로 재정합한다.
 * (Admin SDK 버전)
 *
 * ## 왜 한 호출에서 끝까지 도는가
 * 이전 구현은 문서 1건씩 `update`하며 최대 20건만 처리하고 끝냈다. 그런데 그 update가
 * `onDriveLogUpdated`를 재발동하고, 20번째 문서의 트리거가 다시 21~40번째를 갱신하는 식으로
 * **연쇄가 트리거를 타고 계속됐다**. 즉 `MAX_CHAIN = 20`은 한 호출만 제한하고 전체를 막지
 * 못해서, 기록 1,000건 차량의 km 1 정정이 쓰기 ~1,000건 + 함수 호출 ~2,000회가 됐다.
 *
 * 지금은 한 호출이 페이지 단위 배치로 끝까지(상한까지) 처리하고, 연쇄 쓰기에는
 * `kmSyncRev`를 올려 표시해 `onDriveLogUpdated`가 즉시 반환한다. 쓰기 수는 재정합에
 * 필요한 문서 수 그대로지만(모델상 불가피) 호출·조회는 1회로 줄어든다.
 *
 * ## 상한을 넘으면
 * 마지막 문서에 `kmSyncContinue`를 남기고 종료한다. 그 문서의 update 트리거가 표시를 보고
 * 이어받으므로 **완결성은 유지되고**, 이어받기 호출은 1,000건마다 1회뿐이다.
 *
 * @remarks 단위 테스트(syncDriveLogKm.test.ts)를 위해 export한다.
 */
export async function syncNextLogStartKm(
    orgId: string,
    vehicleId: string,
    afterDate: Date,
    newStartKm: number,
): Promise<KmChainResult> {
    let cursor = afterDate;
    let carryKm = Math.max(0, newStartKm);
    let processed = 0;
    let lastEndKmDelta = 0;
    let reachedEnd = false;
    let stoppedConsistent = false;

    while (processed < MAX_DOCS_PER_RUN) {
        const snap = await db.collection('driveLogs')
            .where('organizationId', '==', orgId)
            .where('vehicleId', '==', vehicleId)
            .where('timestamp', '>', cursor)
            .orderBy('timestamp', 'asc')
            .limit(PAGE_SIZE)
            .get();

        if (snap.empty) {
            reachedEnd = true;
            break;
        }

        const batch = db.batch();
        let writes = 0;
        let lastRef: FirebaseFirestore.DocumentReference | null = null;

        for (const nextDoc of snap.docs) {
            const nextData = nextDoc.data();

            // startKm이 이미 일치하면 이후 기록의 carry도 그대로이므로 여기서 멈춘다
            if (nextData.startKm === carryKm) {
                stoppedConsistent = true;
                break;
            }

            const diff = carryKm - nextData.startKm;
            const oldEndKm = nextData.endKm ?? carryKm;
            // [방어 코드] 주행거리가 마이너스로 전파되는 것 원천 차단
            const newEndKm = Math.max(0, oldEndKm + diff);

            batch.update(nextDoc.ref, {
                startKm: carryKm,
                endKm: newEndKm,
                editedAt: FieldValue.serverTimestamp(),
                [KM_SYNC_REV_FIELD]: FieldValue.increment(1),
            });

            writes++;
            processed++;
            lastEndKmDelta = newEndKm - oldEndKm;
            lastRef = nextDoc.ref;
            carryKm = newEndKm;
            cursor = toDate(nextData.timestamp);

            if (processed >= MAX_DOCS_PER_RUN) break;
        }

        const pageExhausted = snap.docs.length < PAGE_SIZE;
        const truncatedHere = processed >= MAX_DOCS_PER_RUN && !stoppedConsistent;

        if (writes > 0) await batch.commit();

        if (stoppedConsistent) break;
        if (truncatedHere) {
            // 마지막 문서에 이어받기 표시를 남긴다. rev를 함께 올려야 그 문서의 트리거가
            // "연쇄 쓰기" 분기로 들어가 이어받는다 (rev가 그대로면 필드 미변경으로 조기 반환된다).
            if (lastRef) {
                await lastRef.update({
                    [KM_SYNC_CONTINUE_FIELD]: true,
                    [KM_SYNC_REV_FIELD]: FieldValue.increment(1),
                });
            }
            console.warn(
                `[syncNextLogStartKm] 상한 ${MAX_DOCS_PER_RUN}건 도달 — 이어받기 표시 후 중단: org=${orgId}, veh=${vehicleId}`,
            );
            return { processed, lastEndKmDelta, reachedEnd: false, stoppedConsistent: false, truncated: true };
        }
        if (pageExhausted) {
            reachedEnd = true;
            break;
        }
    }

    return { processed, lastEndKmDelta, reachedEnd, stoppedConsistent, truncated: false };
}

/**
 * 연쇄 재정합이 차량의 최신 기록까지 이동시켰다면 차량 누적 km(currentKm)도 같은 폭으로 보정한다.
 *
 * 이전에는 마지막 문서의 update 트리거가 "최신 기록 수정"으로 판정해 우연히 증분해줬다.
 * 재발동을 차단한 뒤에는 그 경로가 사라지므로 여기서 명시적으로 처리한다.
 */
async function applyChainCurrentKm(orgId: string, vehicleId: string, chain: KmChainResult): Promise<void> {
    if (!chain.reachedEnd || chain.lastEndKmDelta === 0) return;

    // 차량이 운행일지의 기관 소속인지 검증 후 갱신 (교차 테넌트 currentKm 오염 차단)
    const vehSnap = await db.collection('vehicles').doc(vehicleId).get();
    if (!vehSnap.exists || vehSnap.data()?.organizationId !== orgId) {
        console.warn(`[applyChainCurrentKm] 차량 org 불일치 — currentKm 보정 건너뜀: veh=${vehicleId}, org=${orgId}`);
        return;
    }

    await db.collection('vehicles').doc(vehicleId).update({
        currentKm: FieldValue.increment(chain.lastEndKmDelta),
    });
}

/**
 * 차를 세운 곳(`endSiteId`)을 차량의 현재 위치로 반영한다.
 *
 * 소급 입력(더 최신 운행이 이미 있는 경우)에는 갱신하지 않는다 — 어제 운행을 오늘 입력했다고
 * 오늘 위치를 덮어쓰면, 차를 찾으러 간 사람이 엉뚱한 곳으로 간다. 판정은 currentKm과 같은
 * `isEffectivelyRetroactive`를 그대로 받아 쓴다(규칙을 따로 만들면 둘이 어긋난다).
 *
 * 차량의 `siteVaries` 플래그는 여기서 다시 보지 않는다. `endSiteId`는 선택 UI가 열린
 * 차량에서만 기록되므로 값의 존재 자체가 이미 판정 결과이고, 여기서 플래그를 다시 읽으면
 * 관리자가 플래그를 끈 순간 처리 중이던 기록이 조용히 버려진다.
 */
async function applyVehicleCurrentSite(
    orgId: string,
    vehId: string,
    endSiteId: unknown,
    ts: Date,
    isEffectivelyRetroactive: boolean,
): Promise<void> {
    if (isEffectivelyRetroactive) return;
    if (typeof endSiteId !== 'string' || !endSiteId) return;

    // 차량이 운행일지의 기관 소속인지 검증 후 갱신 (교차 테넌트 오염 차단 — currentKm과 같은 규칙)
    const vehSnap = await db.collection("vehicles").doc(vehId).get();
    const veh = vehSnap.data();
    if (!vehSnap.exists || veh?.organizationId !== orgId) {
        console.warn(`[applyVehicleCurrentSite] 차량 org 불일치 — 현재 위치 갱신 건너뜀: veh=${vehId}, org=${orgId}`);
        return;
    }

    // 마지막 확인보다 **과거의 운행**은 위치를 되돌리지 않는다.
    //
    // isEffectivelyRetroactive는 "뒤에 다른 운행일지가 있는가"만 본다. 관리자가 기록 없이 차를
    // 옮기고 15:00에 현재 위치를 손으로 고쳤는데 16:00에 누군가 09~10시 운행을 뒤늦게 적으면,
    // 그 일지 뒤에는 아무 기록도 없으므로 소급으로 판정되지 않아 **관리자 보정이 지워진다.**
    const confirmedAt = veh?.currentSiteUpdatedAt;
    const confirmedDate = confirmedAt instanceof Date ? confirmedAt : confirmedAt?.toDate?.();
    if (confirmedDate instanceof Date && confirmedDate.getTime() > ts.getTime()) return;

    await db.collection("vehicles").doc(vehId).update({
        currentSiteId: endSiteId,
        currentSiteUpdatedAt: FieldValue.serverTimestamp(),
    });
}

/**
 * 운전자가 표시한 "주유(충전) 필요"를 차량에 반영한다.
 *
 * 켜기만 한다 — 끄는 것은 주유일지 작성(자동)과 관리자(수동) 몫이다. 운행일지는
 * "연료가 부족했다"는 사실만 증언할 수 있고, 그 뒤에 주유가 있었는지는 모른다.
 *
 * 소급 건에는 손대지 않는다. 3일 전 운행을 오늘 적으면서 표시해도 그 사이 누가
 * 주유했을 수 있어, 지금 차량 상태의 근거가 되지 못한다. 판정은 currentKm·현재 위치와
 * 같은 `isEffectivelyRetroactive`를 그대로 받아 쓴다.
 *
 * 표시된 일지에서만 차량 문서를 읽는다. 대부분의 운행은 표시가 없으므로,
 * 읽기 비용이 운행일지 전체가 아니라 실제 표시 건수에만 붙는다.
 */
async function applyVehicleNeedsRefuel(
    orgId: string,
    vehId: string,
    needsRefuel: unknown,
    ts: Date,
    isEffectivelyRetroactive: boolean,
): Promise<void> {
    if (isEffectivelyRetroactive) return;
    if (needsRefuel !== true) return;

    // 차량이 운행일지의 기관 소속인지 검증 후 갱신 (교차 테넌트 오염 차단 — currentKm과 같은 규칙)
    const vehSnap = await db.collection("vehicles").doc(vehId).get();
    const veh = vehSnap.data();
    if (!vehSnap.exists || veh?.organizationId !== orgId) {
        console.warn(`[applyVehicleNeedsRefuel] 차량 org 불일치 — 주유 필요 표시 건너뜀: veh=${vehId}, org=${orgId}`);
        return;
    }

    // 마지막으로 상태가 바뀐 시각보다 **과거의 운행**은 표시를 되살리지 않는다.
    // 관리자가 15:00에 해제했는데 09:00 운행이 16:00에 뒤늦게 저장되면, 그 일지 뒤에는
    // 아무 기록도 없어 소급으로 판정되지 않아 **관리자 조치가 되돌려진다.**
    const changedAt = veh?.needsRefuelAt;
    const changedDate = changedAt instanceof Date ? changedAt : changedAt?.toDate?.();
    if (changedDate instanceof Date && changedDate.getTime() > ts.getTime()) return;

    await db.collection("vehicles").doc(vehId).update({
        needsRefuel: true,
        needsRefuelAt: FieldValue.serverTimestamp(),
    });
}

/**
 * 위치 갱신은 **누적 km·통계 회계와 분리해서** 실행한다.
 *
 * 두 트리거는 retry: false라 한 번 던지면 이벤트가 사라진다. 표시용 위치 갱신이 일시적
 * UNAVAILABLE로 실패했다고 바깥 catch까지 올라가면, 그 뒤에 있는 currentKm 차분과 기관 통계가
 * **통째로 유실된다.** 위치는 다음 운행이 다시 맞춰 주지만 회계는 스스로 복구되지 않는다.
 */
async function applyVehicleCurrentSiteSafely(
    context: string,
    orgId: string,
    vehId: string,
    endSiteId: unknown,
    ts: Date,
    isEffectivelyRetroactive: boolean,
): Promise<void> {
    try {
        await applyVehicleCurrentSite(orgId, vehId, endSiteId, ts, isEffectivelyRetroactive);
    } catch (error) {
        console.error(`[${context}] 차량 현재 위치 갱신 실패 (km 동기화는 계속 진행):`, error);
        captureError(error, { context, vehId, orgId });
    }
}

/** 주유 필요 표시도 같은 이유로 회계와 분리한다(위 주석 참고). */
async function applyVehicleNeedsRefuelSafely(
    context: string,
    orgId: string,
    vehId: string,
    needsRefuel: unknown,
    ts: Date,
    isEffectivelyRetroactive: boolean,
): Promise<void> {
    try {
        await applyVehicleNeedsRefuel(orgId, vehId, needsRefuel, ts, isEffectivelyRetroactive);
    } catch (error) {
        console.error(`[${context}] 주유 필요 표시 갱신 실패 (km 동기화는 계속 진행):`, error);
        captureError(error, { context, vehId, orgId });
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

            // 차를 세운 곳을 차량의 현재 위치로 반영 (소급이면 건너뛴다)
            await applyVehicleCurrentSiteSafely('onDriveLogCreated', orgId, vehId, data.endSiteId, ts, isEffectivelyRetroactive);
            await applyVehicleNeedsRefuelSafely('onDriveLogCreated', orgId, vehId, data.needsRefuel, ts, isEffectivelyRetroactive);

            // 다음 기록의 startKm 자동 연동 (소급이든 아니든 항상 시도)
            const chain = await syncNextLogStartKm(orgId, vehId, ts, endKm);
            // 소급 삽입으로 최신 기록의 endKm이 밀렸다면 차량 누적 km도 같은 폭으로 보정
            if (isEffectivelyRetroactive) await applyChainCurrentKm(orgId, vehId, chain);

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
            // [재발동 차단] 연쇄 재정합이 만든 쓰기는 여기서 끝낸다.
            // 이 표시가 없던 시절에는 연쇄의 각 update가 다시 연쇄를 돌려 20건 단위 파도로 번졌다.
            if ((data[KM_SYNC_REV_FIELD] ?? 0) !== (oldData[KM_SYNC_REV_FIELD] ?? 0)) {
                // 단, 상한에 걸려 남은 구간이 있으면 이 문서가 이어받는다
                if (data[KM_SYNC_CONTINUE_FIELD] === true) {
                    const orgId = data.organizationId;
                    const vehId = data.vehicleId;
                    const tsRaw = data.timestamp;
                    if (orgId && vehId && tsRaw && data.endKm != null) {
                        const chain = await syncNextLogStartKm(orgId, vehId, toDate(tsRaw), data.endKm);
                        await applyChainCurrentKm(orgId, vehId, chain);
                    }
                    // 표시는 이어받기를 끝낸 **뒤에** 지운다.
                    // 먼저 지우면 도중에 함수가 죽을 때(타임아웃·OOM) 표시가 사라져 1,000건 이후가
                    // 조용히 남는다 — 이 트리거는 retry: false라 이벤트 재전달도 없다.
                    // 반대로 남겨두면 재개 근거가 유지되고, 중복 실행은 멱등이라 해롭지 않다
                    // (같은 값으로 수렴하고 두 번째 실행은 stoppedConsistent로 즉시 끝난다).
                    await afterSnap.ref.update({ [KM_SYNC_CONTINUE_FIELD]: false });
                }
                return;
            }

            // [오프라인 충돌 방어] LWW 기반: 들어온 데이터가 더 과거에 수정된 데이터면 롤백하고 종료
            const isConflict = await resolveDriveLogConflict(afterSnap.ref, oldData, data);
            if (isConflict) return;

            const orgId = data.organizationId || oldData.organizationId;
            const vehId = data.vehicleId || oldData.vehicleId;
            const tsRaw = data.timestamp || oldData.timestamp;
            const ts = tsRaw instanceof Date ? tsRaw : tsRaw?.toDate();
            const isRetro = data.isRetroactive !== undefined ? data.isRetroactive : oldData.isRetroactive;

            // 세운 곳이 **바뀐** 수정만 현재 위치를 다시 맞춘다. 매 수정마다 갱신하면 확인 시각이
            // 실제로 확인되지 않은 시점을 가리켜 신선도 표기가 거짓말이 된다.
            // 아래 km 블록보다 먼저 두는 이유는, 주행거리가 그대로인 수정이 거기서 조기 반환되기 때문이다.
            if (data.endSiteId !== oldData.endSiteId && vehId && orgId && ts) {
                const isRetroactiveForSite = isRetro || await hasLaterDriveLog(orgId, vehId, ts);
                await applyVehicleCurrentSiteSafely('onDriveLogUpdated', orgId, vehId, data.endSiteId, ts, isRetroactiveForSite);
            }

            // 주유 필요도 **새로 표시된** 수정만 반영한다. 수정 화면에는 이 입력이 뜨지 않으므로
            // 실제로는 거의 도달하지 않지만, 나중에 입력을 열더라도 같은 규칙이 지켜지도록 둔다.
            if (data.needsRefuel !== oldData.needsRefuel && vehId && orgId && ts) {
                const isRetroactiveForRefuel = isRetro || await hasLaterDriveLog(orgId, vehId, ts);
                await applyVehicleNeedsRefuelSafely('onDriveLogUpdated', orgId, vehId, data.needsRefuel, ts, isRetroactiveForRefuel);
            }

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
                    const chain = await syncNextLogStartKm(orgId, vehId, ts, data.endKm);
                    // 중간 기록 수정으로 최신 기록까지 밀렸다면 차량 누적 km 보정
                    // (최신 기록 자체를 수정한 경우는 위에서 이미 증분했고, 이때 연쇄 대상이 없어 delta가 0이다)
                    if (isRetroactive) await applyChainCurrentKm(orgId, vehId, chain);
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

                const chain = await syncNextLogStartKm(orgId, vehId, ts, prevEndKm);
                // 중간 기록 삭제로 이후 기록이 앞으로 당겨졌다면 차량 누적 km도 같은 폭으로 보정
                await applyChainCurrentKm(orgId, vehId, chain);
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
