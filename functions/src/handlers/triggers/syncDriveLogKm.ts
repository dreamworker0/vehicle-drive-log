import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { captureError } from "../../core/sentry";
import { log } from "../../utils/helpers";
import { handleStatsOnCreate, handleStatsOnUpdate, handleStatsOnDelete } from "../../services/statistics/updateAggregatedStats";
import { applyDriveLogHipassDelta, usedAmountOf, hipassFieldsDropped, eventDedupeKey } from "../../services/hipass/applyBalanceDelta";
import { isOrgRetired } from "../../utils/orgRetirement";
import * as logger from "firebase-functions/logger";
import {
    hasLaterDriveLog,
    isBeyondRetention,
    toDate,
    syncNextLogStartKm,
    alignNextLogStartKm,
    syncStoredDistance,
    KM_SYNC_REV_FIELD,
    KM_SYNC_CONTINUE_FIELD,
} from "../../services/driveLog/kmChain";
import type { KmChainResult } from "../../services/driveLog/kmChain";
import {
    syncVehicleCurrentKmToLatestLog,
    latestLogMayHaveChanged,
    applyVehicleCurrentSiteSafely,
    applyVehicleNeedsRefuelSafely,
    applyVehicleLastDriveNoteSafely,
    clearVehicleLastDriveNoteSafely,
} from "../../services/driveLog/vehicleSync";

// km 연쇄 재정합은 services/driveLog/kmChain.ts, 차량 문서 보정은 services/driveLog/vehicleSync.ts로
// 나눴다. 이 파일은 세 트리거와 그 흐름만 둔다. 예전에 여기서 export하던 이름은 테스트·다른 모듈의
// import 경로가 바뀌지 않도록 그대로 다시 내보낸다.
export {
    KM_SYNC_REV_FIELD,
    KM_SYNC_CONTINUE_FIELD,
    syncNextLogStartKm,
    alignNextLogStartKm,
    syncStoredDistance,
};
export type { KmChainResult, NextLogAlignment } from "../../services/driveLog/kmChain";

const db = getFirestore();

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
            const isRetro = data.isRetroactive === true;

            // 하이패스 사용액을 카드 잔액에서 뺀다.
            // **km 가드보다 앞에 둔다** — 아래 `endKm == null` 반환에 걸리면 하이패스가 통째로 누락된다.
            // 소급 기록도 반영한다: 소급이어도 그 돈은 실제로 쓰였다(currentKm은 '현재 값'이라 소급을
            // 건너뛰지만, 잔액은 누적 합이라 시점과 무관하다).
            //
            // **보존 기한을 넘긴 기록은 제외한다 — 삭제 쪽과 대칭이다.**
            // `scripts/restoreArchivedLogs.ts`가 아카이브를 되돌릴 때 `batch.set`으로 문서를
            // 다시 만드는데, 그 쓰기도 이 트리거를 깨운다. 거르지 않으면 500건 복원이 **오늘
            // 카드에서 3년 전 통행료를 다시 빼낸다**(삭제 쪽이 환불하던 것의 정확한 거울).
            // 3년 넘은 운행을 지금 손으로 입력하는 경우도 같은 이유로 오늘 잔액과 무관하다.
            if (!isBeyondRetention("onDriveLogCreated", ts)) {
                await applyDriveLogHipassDelta("onDriveLogCreated", orgId, vehId, usedAmountOf(data), eventDedupeKey(event.id, "delta"));
            }

            if (!orgId || !vehId || !ts || endKm == null) return;

            // 뒤에 기록이 있는가 — 차량 km는 이것만 본다(시간상 최근 기록을 따라가므로).
            // 현재 위치·주유 필요·직전 비고는 운전자가 표시한 소급 여부까지 함께 본다.
            const hasLater = await hasLaterDriveLog(orgId, vehId, ts);
            const isEffectivelyRetroactive = isRetro || hasLater;

            // 차를 세운 곳을 차량의 현재 위치로 반영 (소급이면 건너뛴다)
            await applyVehicleCurrentSiteSafely('onDriveLogCreated', orgId, vehId, data.endSiteId, ts, isEffectivelyRetroactive);
            await applyVehicleNeedsRefuelSafely('onDriveLogCreated', orgId, vehId, data.needsRefuel, ts, isEffectivelyRetroactive);
            // 직전 비고를 차량에 옮겨 다음 사람이 차를 가지러 가기 전에 읽게 한다 (소급이면 건너뛴다)
            await applyVehicleLastDriveNoteSafely('onDriveLogCreated', orgId, vehId, data.notes, data.driverName, ts, isEffectivelyRetroactive);

            // 다음 기록의 startKm 자동 연동 (소급이든 아니든 항상 시도)
            const chain = await syncNextLogStartKm(orgId, vehId, ts, endKm);
            // 차량 누적 km를 최근 기록의 도착 km로 맞춘다 (소급 삽입이 최근 기록까지 밀었을 때 포함)
            if (latestLogMayHaveChanged(hasLater, chain)) {
                await syncVehicleCurrentKmToLatestLog('onDriveLogCreated', orgId, vehId);
            }

            // [통합 트리거] 기관 통계 증분 업데이트
            await handleStatsOnCreate(orgId, data);
        } catch (error) {
            logger.error('[onDriveLogCreated] km 동기화 오류:', error);
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
            // 하이패스 사용액의 **차액만** 반영한다.
            // 아래 어느 조기 반환보다도 앞에 둔다 — 특히 "주요 마일리지 필드 변경 없음" 분기에
            // 걸리면 하이패스만 고친 수정이 잔액에 영영 반영되지 않는다.
            // 연쇄 재정합이 만든 쓰기는 하이패스 필드를 건드리지 않으므로 여기서 차액이 0이다.
            //
            // **차량이 바뀌면 카드도 바뀐다.** Rules의 `driveLogs` update는 작성자 분기에서만
            // vehicleId를 얼리고(`hasAny([... 'vehicleId' ...])`), **기관관리자·superAdmin 분기는
            // 차량 변경을 허용한다**. 차액만 반영하면 옛 차량의 카드가 그 돈을 계속 물고 있고
            // 새 차량의 카드는 손도 대지 않은 채 남는다 — 두 카드가 동시에 어긋난다.
            // 그래서 옛 카드에서 빼고 새 카드에 더한다(`onHipassChargeUpdated`의 카드 이동과 같은 처리).
            // 기관 변경도 같은 처리다 — superAdmin은 `organizationId`까지 바꿀 수 있는데,
            // 차량이 그대로면 새 기관에는 그 차량의 카드가 없어 `else` 분기가 아무것도 못 한다.
            // 그러면 **옛 기관 카드가 그 금액을 계속 문 채** 남는다.
            // 하이패스 기록이 **사라진 수정은 환불이 아니다.** 결정론적 ID로 같은 운행을
            // 다시 저장할 때(setDoc, merge 아님) 카드 조회 실패·빈 입력이면 필드가 통째로
            // 빠지는데, 그대로 두면 실제로 쓴 돈이 잔액으로 돌아온다. 값이 아니라 기록이
            // 없어진 것이므로 잔액은 그대로 두고 사실만 남긴다.
            if (hipassFieldsDropped(oldData, data)) {
                log("WARNING", "onDriveLogUpdated", "하이패스 기록이 사라진 수정 — 잔액은 건드리지 않는다", {
                    logId, used: usedAmountOf(oldData),
                });
            } else if (oldData.vehicleId !== data.vehicleId || oldData.organizationId !== data.organizationId) {
                await applyDriveLogHipassDelta("onDriveLogUpdated", oldData.organizationId, oldData.vehicleId, -usedAmountOf(oldData), eventDedupeKey(event.id, "old"));
                await applyDriveLogHipassDelta("onDriveLogUpdated", data.organizationId, data.vehicleId, usedAmountOf(data), eventDedupeKey(event.id, "new"));
            } else {
                await applyDriveLogHipassDelta(
                    "onDriveLogUpdated",
                    data.organizationId,
                    data.vehicleId,
                    usedAmountOf(data) - usedAmountOf(oldData),
                    eventDedupeKey(event.id, "delta"),
                );
            }

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
                        if (latestLogMayHaveChanged(true, chain)) {
                            await syncVehicleCurrentKmToLatestLog('onDriveLogUpdated', orgId, vehId);
                        }
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

            await syncStoredDistance(afterSnap.ref, oldData, data);

            const orgId = data.organizationId || oldData.organizationId;
            const vehId = data.vehicleId || oldData.vehicleId;
            const tsRaw = data.timestamp || oldData.timestamp;
            const ts = tsRaw instanceof Date ? tsRaw : tsRaw?.toDate();
            // `data`는 델타가 아니라 **쓰기 후 문서 전체**다. 그래서 "없으면 예전 값"이라는
            // 되돌림은 뜻이 없고, 오히려 해롭다 — 소급으로 적었던 일지를 오늘 도착으로 고쳐
            // 클라이언트가 이 필드를 지워도 여기서 옛 true가 되살아나, 차량 km·세운 곳·주유
            // 필요 갱신을 계속 건너뛰었다. 화면은 고쳐졌는데 차량 상태만 안 따라오는 상태다.
            // 생성 쪽(onDriveLogCreated)이 쓰는 판정과 같은 모양으로 맞춘다.
            const isRetro = data.isRetroactive === true;

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

            // 비고가 **바뀐** 수정만 차량에 다시 싣는다. 대부분의 수정은 비고와 무관하고,
            // 매번 들어가면 운행일지 수정 한 번마다 차량 문서 읽기가 하나씩 늘어난다.
            // 비고를 지운 수정도 여기에 걸린다 — 지우는 것 역시 반영해야 할 변경이다.
            if (data.notes !== oldData.notes && vehId && orgId && ts) {
                const isRetroactiveForNote = isRetro || await hasLaterDriveLog(orgId, vehId, ts);
                await applyVehicleLastDriveNoteSafely('onDriveLogUpdated', orgId, vehId, data.notes, data.driverName, ts, isRetroactiveForNote);
            }

            if (data.endKm !== undefined && vehId && orgId && ts) {
                // 이전 endKm과 현재 endKm이 동일하다면 부수효과를 실행할 필요가 없음
                // (다만 startKm이 바뀌는 등의 시나리오는 distance로 잡거나 앞 기록에서 파급됨)
                if (data.endKm === oldData.endKm && data.startKm === oldData.startKm && data.distance === oldData.distance) {
                    return; // 주요 마일리지 필드 변경 없음
                }

                // 차량 km는 시간상 최근 기록을 따라가므로 운전자가 표시한 소급 여부(isRetro)는 보지 않는다.
                // 소급으로 적었어도 뒤에 기록이 없으면 그 도착 km가 지금 계기판에 가장 가까운 값이다.
                const hasLater = await hasLaterDriveLog(orgId, vehId, ts);

                // endKm 변경 시 다음 기록의 출발 km만 맞춘다 (alignNextLogStartKm 주석).
                // 출발만으로 맞출 수 없을 때(거리가 음수가 될 때)만 뒤 기록을 함께 민다.
                let chain: KmChainResult | null = null;
                if (data.endKm !== oldData.endKm) {
                    const alignment = await alignNextLogStartKm(orgId, vehId, ts, data.endKm);
                    if (alignment === 'push') {
                        chain = await syncNextLogStartKm(orgId, vehId, ts, data.endKm);
                    }
                }
                // 최근 기록을 고쳤거나 중간 기록 수정이 최근 기록까지 밀었다면 차량 누적 km를 다시 맞춘다
                if (latestLogMayHaveChanged(hasLater, chain)) {
                    await syncVehicleCurrentKmToLatestLog('onDriveLogUpdated', orgId, vehId);
                }
            }

            // [통합 트리거] 기관 통계 차분 업데이트
            const finalOrgId = data.organizationId || oldData.organizationId;
            if (finalOrgId) {
                await handleStatsOnUpdate(finalOrgId, oldData, data);
            }
        } catch (error) {
            logger.error('[onDriveLogUpdated] km 동기화 오류:', error);
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
            const startKm = data.startKm;

            // **해지된 기관의 파기는 제외한다**(purgeOrganizationData). 보존 기한 정리와 같은 이유로
            // 파기는 거래를 되돌리는 일이 아니다 — 환불·km 차감·통계 차감을 하지 않는다. 차량이 먼저
            // 지워진 뒤라면 km 보정이 NOT_FOUND로 실패해 건마다 알림이 쏟아지기도 한다.
            if (await isOrgRetired(orgId)) return;

            // 지워진 기록이 쓴 하이패스 사용액을 잔액에 되돌린다(km 가드보다 앞).
            //
            // **보존 기한 정리는 제외한다.** 야간 배치(`archiveLogs`)가 3년 지난 기록을
            // GCS로 옮기고 500건씩 batch.delete 하는데, 그 삭제도 이 트리거를 깨운다.
            // 거르지 않으면 **3년 전에 쓴 통행료가 오늘 카드 잔액으로 환불된다** — 밤마다,
            // 조용히. 보존 기한 정리는 역사를 덜어내는 일이지 거래를 되돌리는 일이 아니다.
            // (누적 km가 같은 사고를 피한 것은 `hasLaterDriveLog` 덕분인데, 잔액은 '현재 값'이
            //  아니라 누적 합이라 그 가드가 듣지 않는다. 그래서 경계를 명시적으로 본다.)
            if (!isBeyondRetention("onDriveLogDeleted", ts)) {
                await applyDriveLogHipassDelta("onDriveLogDeleted", orgId, vehId, -usedAmountOf(data), eventDedupeKey(event.id, "delta"));
            }

            if (!orgId || !vehId || !ts) return;

            // [통합 트리거] 기관 통계 차감 업데이트
            // **km 재정합보다 앞에 둔다.** 재정합이 실패해도(예: 여러 건을 한꺼번에 지울 때의
            // 경쟁) 이 기록은 이미 지워졌으므로 통계에서는 반드시 빠져야 한다. 뒤에 두면 예외에
            // 걸려 건너뛰고, 이 트리거는 재시도하지 않아 지운 기록이 통계에 영영 남는다.
            await handleStatsOnDelete(orgId, data);

            // 그 일지가 차량에 남긴 비고 사본을 함께 지운다. 원본을 지웠는데 사본이 남으면
            // 지울 수 있는 사람이 아무도 없다(관리자 직접 수정 경로를 열지 않았다).
            // 보존 기한은 보지 않는다 — 오래된 사본일수록 지워야 할 이유가 크다.
            await clearVehicleLastDriveNoteSafely('onDriveLogDeleted', orgId, vehId, ts);

            // 최신 기록 삭제 여부 판별 (자기 자신은 삭제되었으므로 본인 이후의 기록이 있는지 확인)
            const hasLater = await hasLaterDriveLog(orgId, vehId, ts);

            let chain: KmChainResult | null = null;
            if (hasLater) {
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

                chain = await syncNextLogStartKm(orgId, vehId, ts, prevEndKm, { onAnchored: 'stop' });
            }

            // 최근 기록이 지워졌으면 그 앞 기록의, 중간 기록 삭제가 최근 기록까지 당겼으면 그 기록의
            // 도착 km로 차량 누적 km를 맞춘다. 기록이 하나도 남지 않으면 지운 기록의 출발 km로 돌린다
            // (그 운행 전의 계기판 — 예전의 "거리만큼 차감"과 같은 결과다).
            if (latestLogMayHaveChanged(hasLater, chain)) {
                await syncVehicleCurrentKmToLatestLog('onDriveLogDeleted', orgId, vehId, startKm);
            }
        } catch (error) {
            logger.error('[onDriveLogDeleted] km 동기화(삭제) 오류:', error);
            captureError(error, { context: 'onDriveLogDeleted', logId });
        }
    }
);
