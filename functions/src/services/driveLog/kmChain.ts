/**
 * kmChain — 운행일지 km 연쇄 재정합
 *
 * 소급 입력·수정·삭제 때 같은 차량의 뒤 기록 출발/도착 km를 맞추는 로직과 그 판정 헬퍼를 모은다.
 * 트리거(handlers/triggers/syncDriveLogKm.ts)에서 책임별로 분리했다 — 동작은 그대로다.
 */
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { log } from "../../utils/helpers";
import { handleStatsOnUpdate } from "../statistics/updateAggregatedStats";
import { driveLogRetentionCutoff } from "../../utils/constants";
import * as logger from "firebase-functions/logger";

const db = getFirestore();

/** 
 * 특정 시점 이후에 같은 차량의 운행기록이 존재하는지 확인 (Admin SDK 버전)
 */
export async function hasLaterDriveLog(orgId: string, vehicleId: string, afterTimestamp: Date): Promise<boolean> {
    const q = db.collection('driveLogs')
        .where('organizationId', '==', orgId)
        .where('vehicleId', '==', vehicleId)
        .where('timestamp', '>', afterTimestamp)
        .limit(1);
    const snap = await q.get();
    return !snap.empty;
}

/**
 * 이 기록이 **보존 기한 밖**인가 — 그렇다면 하이패스 잔액을 건드리지 않는다.
 *
 * 잔액은 '오늘 카드에 남은 돈'이고, 보존 기한 밖 문서의 생성·삭제는 그 돈과 무관한
 * 사건이다(야간 아카이브의 `batch.delete`, 복원 스크립트의 `batch.set`). 거르지 않으면
 * 3년 전 통행료가 오늘 환불되거나 다시 빠져나간다.
 *
 * **건너뛴 사실을 남긴다.** 관리자가 3년 넘은 기록을 직접 지웠을 때도 환불이 안 되는데,
 * 흔적이 없으면 "왜 잔액이 안 돌아왔나"를 추적할 길이 없다. 배치는 조용한 대량 삭제라
 * INFO로 충분하고, Cloud Logging에서 건수로 보인다.
 *
 * `ts`가 없으면 **보존 기한 안쪽으로 본다**(= 반영한다). 아카이브 조회가
 * `where("timestamp","<",cutoff)`라 timestamp 없는 문서는 애초에 대상이 아니고,
 * 기본값은 "돈을 맞춘다" 쪽이어야 한다.
 */
export function isBeyondRetention(
    context: string,
    ts: Date | undefined | null,
    /** 건너뛴 대상 — 잔액 말고도 이 경계를 쓰는 곳이 생겨서 로그에 무엇을 건드리지 않았는지 남긴다. */
    what = "하이패스 잔액을 건드리지 않는다",
): boolean {
    if (ts == null) return false;
    if (ts >= driveLogRetentionCutoff()) return false;
    log("INFO", context, `보존 기한 밖 기록이라 ${what}`, {
        timestamp: ts.toISOString(),
    });
    return true;
}

/** 한 번의 호출에서 재정합할 최대 문서 수. 초과분은 마지막 문서에 이어받기 표시를 남겨 계속한다. */
const MAX_DOCS_PER_RUN = 1000;
/** 한 번에 조회·커밋하는 페이지 크기 (Firestore 배치 상한 500 이내) */
const PAGE_SIZE = 200;
/** 조회와 커밋 사이에 문서가 지워져 배치가 실패했을 때 그 페이지를 다시 조회하는 최대 횟수 */
const MAX_PAGE_RETRIES = 2;

/** Firestore NOT_FOUND(gRPC 5) — 없는 문서에 update를 걸었을 때 난다 */
function isNotFoundError(error: unknown): boolean {
    return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 5;
}

/** 연쇄 쓰기임을 표시하는 필드 — 이 값이 변한 update는 트리거가 즉시 반환한다(재발동 차단). */
export const KM_SYNC_REV_FIELD = 'kmSyncRev';
/** 상한에 걸려 중단됐음을 마지막 문서에 남기는 표시 — 그 문서의 트리거가 이어받는다. */
export const KM_SYNC_CONTINUE_FIELD = 'kmSyncContinue';

export function toDate(value: unknown): Date {
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
    /**
     * 사진으로 확인한 도착 km를 만났을 때 어떻게 할 것인가.
     *
     * - `absorb`(기본): 출발만 맞추고 도착은 고정한다 — 정정 폭이 그 기록에서 흡수된다.
     *   **소급 삽입·수정**에 맞는 처리다. 그 기록의 출발 km가 애초에 틀렸던 것이므로
     *   거리를 다시 세는 것이 사실에 가깝다.
     * - `stop`: 손대지 않고 거기서 멈춘다. **삭제**에 맞는 처리다. 지워진 것은 앞 기록이고
     *   뒤 기록의 계기판은 그때 실제로 그랬으므로, 출발을 당기면 지워진 운행의 거리가
     *   엉뚱한 사람·날짜의 기록으로 옮겨 붙는다(빈 구간은 빈 채로 두는 것이 맞다).
     */
    { onAnchored = 'absorb' }: { onAnchored?: 'absorb' | 'stop' } = {},
): Promise<KmChainResult> {
    let cursor = afterDate;
    let carryKm = Math.max(0, newStartKm);
    let processed = 0;
    let lastEndKmDelta = 0;
    let reachedEnd = false;
    let stoppedConsistent = false;
    let pageRetries = 0;

    while (processed < MAX_DOCS_PER_RUN) {
        // 커밋이 실패하면 이 페이지를 처음부터 다시 계산하도록 시작 상태를 남긴다
        const pageStart = { cursor, carryKm, processed, lastEndKmDelta };

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
        // 도착 km를 고정한 기록은 **거리가 바뀐다**. 연쇄 쓰기는 update 트리거가 조기
        // 반환하므로(재발동 차단) 집계가 저절로 따라오지 않는다 — 커밋 뒤 직접 반영한다.
        const statsUpdates: Array<{ before: FirebaseFirestore.DocumentData; after: FirebaseFirestore.DocumentData }> = [];

        for (const nextDoc of snap.docs) {
            const nextData = nextDoc.data();

            // startKm이 이미 일치하면 이후 기록의 carry도 그대로이므로 여기서 멈춘다
            if (nextData.startKm === carryKm) {
                stoppedConsistent = true;
                break;
            }

            const diff = carryKm - nextData.startKm;
            const oldEndKm = nextData.endKm ?? carryKm;

            // 사진으로 확인한 도착 계기판은 **밀지 않는다**(출발만 맞추고 거리를 다시 센다).
            //
            // 정정 폭이 여기서 흡수되므로 그 뒤 기록은 손대지 않게 된다 — 다음 회차에서
            // startKm이 이미 일치해 stoppedConsistent로 끝난다. 앞 기록의 정정값이 사진
            // 값을 넘어서면(거리가 음수가 되면) 고정을 포기하고 예전처럼 민다. 그때는 둘
            // 중 하나가 틀린 것인데, 음수 거리를 남기면 통계까지 함께 망가진다.
            const anchored = nextData.endKmSource === 'ocr' && oldEndKm >= carryKm;

            // 삭제로 촉발된 재정합은 사진 기록을 아예 건드리지 않고 멈춘다
            if (anchored && onAnchored === 'stop') {
                log("INFO", "syncNextLogStartKm", "사진으로 확인한 기록을 만나 재정합을 멈춘다", {
                    logId: nextDoc.id, photoEndKm: oldEndKm,
                });
                stoppedConsistent = true;
                break;
            }

            if (nextData.endKmSource === 'ocr' && !anchored) {
                log("WARNING", "syncNextLogStartKm", "사진으로 확인한 도착 km보다 앞 기록의 정정값이 커서 고정하지 못했다", {
                    logId: nextDoc.id, photoEndKm: oldEndKm, newStartKm: carryKm,
                });
            }

            // [방어 코드] 주행거리가 마이너스로 전파되는 것 원천 차단
            const newEndKm = anchored ? oldEndKm : Math.max(0, oldEndKm + diff);

            const patch: FirebaseFirestore.DocumentData = {
                startKm: carryKm,
                endKm: newEndKm,
                editedAt: FieldValue.serverTimestamp(),
                [KM_SYNC_REV_FIELD]: FieldValue.increment(1),
            };
            if (anchored) {
                // 고정된 기록만 거리가 달라진다(민 기록은 출발·도착이 같은 폭으로 움직여 거리가 그대로다)
                patch.distance = newEndKm - carryKm;
                statsUpdates.push({ before: { ...nextData }, after: { ...nextData, ...patch } });
            }
            batch.update(nextDoc.ref, patch);

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

        // 같은 차량의 기록을 여러 건 한꺼번에 지우면, 조회에 잡힌 뒤 기록이 커밋 전에 지워질 수
        // 있다(각 삭제 트리거가 서로의 뒤 기록을 고치려 든다). 배치는 원자적이라 한 건이라도
        // 없으면 페이지 전체가 NOT_FOUND로 실패하고 아무것도 쓰이지 않는다 — 다시 조회하면
        // 지워진 문서는 빠지므로 같은 페이지를 처음부터 다시 계산한다.
        if (writes > 0) {
            try {
                await batch.commit();
            } catch (error) {
                if (!isNotFoundError(error) || pageRetries >= MAX_PAGE_RETRIES) throw error;
                pageRetries++;
                log("INFO", "syncNextLogStartKm", "재정합 중 뒤 기록이 지워져 이 페이지를 다시 조회한다", {
                    orgId, vehicleId, attempt: pageRetries,
                });
                ({ cursor, carryKm, processed, lastEndKmDelta } = pageStart);
                stoppedConsistent = false;
                continue;
            }
        }
        for (const { before, after } of statsUpdates) {
            await handleStatsOnUpdate(orgId, before, after);
        }

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
            logger.warn(
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

/** 사람이 고친 도착 km에 다음 기록을 맞춘 결과 */
export type NextLogAlignment =
    /** 뒤 기록이 없다 */
    | 'none'
    /** 다음 기록 출발이 이미 맞다 (화면의 인접 자동 조정이 먼저 맞춘 경우가 대부분) */
    | 'aligned'
    /** 다음 기록의 출발 km만 고쳤다 */
    | 'stretched'
    /** 출발만 고치면 그 기록의 거리가 음수가 된다 — 호출부가 뒤 기록을 함께 민다 */
    | 'push';

/**
 * 사람이 운행일지의 도착 km를 고쳤을 때 **바로 다음 기록의 출발 km만** 맞춘다.
 *
 * 다음 기록의 도착 km는 그 운전자가 계기판을 보고 적은 값이라 건드리지 않는다. 출발이 바뀐 만큼
 * 그 기록의 거리가 늘거나 줄고, 그 뒤 기록과 차량 km는 그대로다.
 *
 * 예전에는 여기서 연쇄 재정합(`syncNextLogStartKm`)으로 출발·도착을 같은 폭으로 밀었다. 그런데 화면의
 * 인접 자동 조정(`adjustAdjacentLogs`)은 출발만 맞추고, 대개 이 트리거보다 먼저 저장된다 — 그러면
 * 연쇄가 "이미 맞다"며 바로 멈춰서 결과가 출발만 맞춘 것이 됐다. 통신이 느려 트리거가 먼저 돌면
 * 뒤 기록 전체와 차량 km가 밀렸다. **같은 수정이 그때그때 다른 결과**를 냈으므로 출발만 맞추는 쪽으로
 * 통일한다(2026-11-11 운영자 결정).
 *
 * 출발만 고치면 거리가 음수가 되는 경우(고친 도착 km가 다음 기록의 도착 km보다 크다)는 계기판 숫자끼리
 * 모순이라 출발만으로는 맞출 수 없다 — `push`를 돌려 호출부가 예전처럼 민다. 화면 쪽도 같은 경계를 쓴다.
 *
 * 이 쓰기에는 `kmSyncRev`를 올리지 않는다. 다음 기록의 트리거가 평소 수정처럼 돌아야 그 기록의 기관
 * 통계 거리와 저장된 distance가 따라온다(도착 km가 그대로라 연쇄는 일어나지 않는다).
 *
 * @remarks 단위 테스트(syncDriveLogKm.test.ts)를 위해 export한다.
 */
export async function alignNextLogStartKm(
    orgId: string,
    vehicleId: string,
    afterDate: Date,
    newEndKm: number,
): Promise<NextLogAlignment> {
    const snap = await db.collection('driveLogs')
        .where('organizationId', '==', orgId)
        .where('vehicleId', '==', vehicleId)
        .where('timestamp', '>', afterDate)
        .orderBy('timestamp', 'asc')
        .limit(1)
        .get();
    if (snap.empty) return 'none';

    const next = snap.docs[0];
    const nextData = next.data();
    if (nextData.startKm === newEndKm) return 'aligned';
    if (typeof nextData.endKm === 'number' && newEndKm > nextData.endKm) return 'push';

    await next.ref.update({ startKm: newEndKm, editedAt: FieldValue.serverTimestamp() });
    return 'stretched';
}

/**
 * 저장된 주행거리(`distance`)를 고친 km에 맞춘다.
 *
 * 운행일지 작성 화면과 외부 대여 반납은 저장할 때 `distance`(도착 − 출발)를 함께 쓴다(buildLogData·
 * buildExternalLoanDriveLog). 사진으로 고정한 도착 km를 연쇄 재정합이 흡수할 때도 이 트리거가 쓴다.
 * 통계·분석 화면과 엑셀(`logDistance`), 서비스 대시보드(`computeDistance`)는 저장된 값을 **먼저** 쓰는데,
 * 인접 기록 자동 조정(`adjustAdjacentLogs`)과 다음 기록 출발 맞추기(`alignNextLogStartKm`)는 km만 바꾸므로
 * 그대로 두면 낡은 거리가 집계된다.
 *
 * (처음 이 함수를 넣을 때 "앱은 distance를 쓰지 않는다"고 적었는데 틀렸다 — 2026-11-11 바로잡음.
 *  대부분의 기록에 값이 있으므로 인접 조정 한 번마다 이 보정 쓰기가 한 번씩 따라온다.)
 *
 * 그래서 km가 바뀐 수정에서 저장된 값이 있고 어긋날 때만 다시 쓴다. 값이 없는 옛 기록은 건드리지 않는다. 연쇄 재정합과 같은 표시(`kmSyncRev`)를 올려, 이 쓰기가 만든 update는
 * 위 재발동 차단에서 바로 끝난다. 연쇄가 민 기록은 출발·도착이 같은 폭으로 움직여 거리가 그대로이므로
 * 여기 올 일이 없다.
 *
 * @remarks 단위 테스트(syncDriveLogKm.test.ts)를 위해 export한다.
 */
export async function syncStoredDistance(
    ref: FirebaseFirestore.DocumentReference,
    before: FirebaseFirestore.DocumentData,
    after: FirebaseFirestore.DocumentData,
): Promise<void> {
    if (after.startKm === before.startKm && after.endKm === before.endKm) return;
    if (after.distance == null) return;
    const start = Number(after.startKm);
    const end = Number(after.endKm);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    const fresh = Math.max(0, end - start);
    if (Number(after.distance) === fresh) return;
    await ref.update({ distance: fresh, [KM_SYNC_REV_FIELD]: FieldValue.increment(1) });
}
