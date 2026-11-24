/**
 * vehicleSync — 운행일지 변경을 차량 문서에 반영
 *
 * 누적 km(currentKm)·현재 위치·주유 필요·직전 비고를 차량 문서에 맞추는 로직과,
 * 그 실패가 km 회계를 막지 않도록 감싸는 *Safely 래퍼를 모은다.
 * 트리거(handlers/triggers/syncDriveLogKm.ts)에서 책임별로 분리했다 — 동작은 그대로다.
 */
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { captureError } from "../../core/sentry";
import * as logger from "firebase-functions/logger";
import { isBeyondRetention } from "./kmChain";
import type { KmChainResult } from "./kmChain";

const db = getFirestore();

/**
 * 차량 누적 km(currentKm)를 **그 차량의 가장 최근 운행일지 도착 km**로 맞춘다.
 *
 * ## 왜 거리를 더하지 않고 최근 기록을 따라가는가
 * 예전에는 운행 거리(도착 − 출발)를 더해 갔다. 그러면 기록하지 않은 운행(앞 기록 도착 100,
 * 다음 기록 출발 120)의 20km가 영영 빠지고, 차량 등록 때 넣은 숫자가 틀렸으면 그 차이도
 * 계속 남았다. 차량 관리 화면의 km가 운행일지·주유일지의 계기판 숫자와 어긋난다는 문의로
 * 드러났다(2026-11-03 기관 문의). 운행일지의 도착 km는 운전자가 계기판을 보고 적은
 * 값이라, 가장 최근 기록을 따라가면 계기판에 가깝게 유지되고 틀어져도 다음 기록이 바로잡는다.
 *
 * 관리자가 차량 수정에서 손으로 넣은 값도 다음 운행일지가 저장되면 그 도착 km로 덮인다.
 * 기록이 하나도 없는 차량은 `fallbackKm`(없으면 그대로)을 쓴다.
 *
 * ## 차량이 운행일지의 기관 소속일 때만 쓴다
 * Rules는 운행일지 생성 때 vehicleId가 자기 기관 차량인지 보지 않고, 기관관리자는 수정 때
 * vehicleId를 바꿀 수도 있다. 여기서 거르지 않으면 다른 기관 차량의 문서 ID만 알아도 자기 기관
 * 일지를 그 ID로 만든 뒤 수정·삭제해서 그 차량의 currentKm을 덮어쓸 수 있다
 * (교차 테넌트 오염 — 2026-07-04 감사 N3, 2026-10 규칙 감사에서 수정·삭제 경로 누락 확인).
 * 최근 기록 조회도 운행일지의 기관으로 거르므로, 남의 기관 일지가 그 차량의 값을 정하지 못한다.
 *
 * 차량이 없거나 기관이 다르면 경고만 남기고 건너뛴다. 값이 같으면 쓰지 않는다.
 */
export async function syncVehicleCurrentKmToLatestLog(
    context: string,
    orgId: string,
    vehId: string,
    fallbackKm?: unknown,
): Promise<void> {
    const latestSnap = await db.collection('driveLogs')
        .where('organizationId', '==', orgId)
        .where('vehicleId', '==', vehId)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();
    const km = latestSnap.empty ? fallbackKm : latestSnap.docs[0].data().endKm;
    // 최근 기록에 도착 km가 없으면(아직 운행 중 등) 지금 값을 그대로 둔다
    if (typeof km !== 'number' || !Number.isFinite(km) || km < 0) return;

    const vehRef = db.collection("vehicles").doc(vehId);
    const vehSnap = await vehRef.get();
    if (!vehSnap.exists || vehSnap.data()?.organizationId !== orgId) {
        logger.warn(`[${context}] 차량 org 불일치 — currentKm 갱신 건너뜀: veh=${vehId}, org=${orgId}`);
        return;
    }
    if (vehSnap.data()?.currentKm === km) return;
    await vehRef.update({ currentKm: km });
}

/**
 * 이번 변경으로 차량의 **가장 최근 기록의 도착 km**가 바뀌었을 수 있는가.
 *
 * 뒤에 기록이 없으면 이 기록이 최근 기록이다. 뒤에 기록이 있어도 연쇄 재정합이 끝까지 닿아
 * 무언가를 옮겼다면 최근 기록도 움직였다. 그 밖의 경우(중간 기록만 바뀌고 연쇄가 도중에 멈춤)는
 * 최근 기록이 그대로라 조회하지 않는다 — 야간 아카이브의 대량 삭제가 차량마다 조회를 하나씩
 * 더 붙이지 않게 한다.
 */
export function latestLogMayHaveChanged(hasLater: boolean, chain: KmChainResult | null): boolean {
    if (!hasLater) return true;
    return !!chain && chain.reachedEnd && chain.processed > 0;
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
        logger.warn(`[applyVehicleCurrentSite] 차량 org 불일치 — 현재 위치 갱신 건너뜀: veh=${vehId}, org=${orgId}`);
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
        logger.warn(`[applyVehicleNeedsRefuel] 차량 org 불일치 — 주유 필요 표시 건너뜀: veh=${vehId}, org=${orgId}`);
        return;
    }

    // 이미 켜져 있으면 다시 쓰지 않는다. 표시된 운행마다 덮어쓰면 needsRefuelAt이
    // '상태가 바뀐 시각'이 아니라 '마지막으로 표시된 시각'이 되어, 화면의 "언제부터
    // 필요했는지"가 계속 새 값으로 밀린다(해제 쪽 clearRefuelFlag도 같은 이유로 건너뛴다).
    if (veh?.needsRefuel === true) return;

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

/** 차량 문서로 옮겨 싣는 비고의 최대 길이. 넘치면 잘라 담는다(전문은 운행일지에 그대로 남는다). */
const LAST_DRIVE_NOTE_MAX = 300;

/**
 * 직전 운행의 비고를 차량 문서로 복사한다 — 다음 사람이 **차를 가지러 가기 전에** 읽도록.
 *
 * 원본은 운행일지에 있는데도 굳이 옮기는 이유는 **읽는 쪽**의 사정이다. 오늘의 예약 카드는
 * 차량 목록만 읽고 일지는 읽지 않는다. 카드에서 직접 조회하면 전 운전자가 매일 여는 화면에
 * 예약마다 읽기가 하나씩 붙는다. 여기로 옮기면 그 화면의 읽기가 늘지 않는다.
 *
 * 대신 **트리거 쪽에서는 늘어난다** — 차량 문서를 한 번 읽고, 바뀔 때 한 번 쓴다. 바로 위
 * `applyVehicleNeedsRefuel`은 표시된 일지에서만 읽지만 여기서는 그럴 수 없다. 비고가 비어
 * 있어도 **앞사람이 남긴 값을 지워야 하는지** 알아야 하고, 그건 읽어 봐야 안다. 운행일지
 * 한 건당 차량 문서 읽기 1회가 붙는 것이 이 기능의 서버 측 값이다.
 *
 * **비고를 지운 수정은 차량의 값도 지운다.** 앞 운전자의 "3층 B-12"가 남아 있는 쪽이
 * 아무것도 안 보이는 쪽보다 나쁘다 — 사람을 엉뚱한 층으로 보낸다.
 *
 * 소급 건에는 손대지 않는다. 3일 전 운행을 오늘 적으면서 주차 위치를 남겨도 그 뒤에 차가
 * 몇 번 더 움직였을 수 있어, 지금 차가 어디 있는지의 근거가 되지 못한다. 판정은 currentKm·
 * 현재 위치와 같은 `isEffectivelyRetroactive`를 그대로 받아 쓴다.
 */
async function applyVehicleLastDriveNote(
    orgId: string,
    vehId: string,
    notes: unknown,
    driverName: unknown,
    ts: Date,
    isEffectivelyRetroactive: boolean,
): Promise<void> {
    if (isEffectivelyRetroactive) return;

    // 보존 기한 밖 기록은 오늘의 차량 상태와 무관하다 — 하이패스와 같은 경계를 본다.
    // `scripts/restoreArchivedLogs.ts`가 아카이브를 `batch.set`으로 되돌리면 이 트리거가
    // 깨는데, 거르지 않으면 **3년 전에 적은 비고가 살아 있는 차량 문서로 되살아난다.**
    // 화면에는 14일 컷에 걸려 안 보이지만, 정리했던 개인정보가 활성 문서로 돌아오는 것은
    // 그 자체로 되돌리면 안 되는 일이다.
    if (isBeyondRetention("applyVehicleLastDriveNote", ts, "직전 비고를 차량에 싣지 않는다")) return;

    // 글자 단위로 자른다. `slice`는 UTF-16 코드 유닛을 세므로 이모지가 경계에 걸리면
    // 짝 잃은 서러게이트가 남는다.
    const trimmed = typeof notes === "string" ? notes.trim() : "";
    const note = [...trimmed].slice(0, LAST_DRIVE_NOTE_MAX).join("");
    const by = typeof driverName === "string" ? driverName.trim() : "";

    // 신선도 판정과 표시에 쓸 시각. `ts`는 운전자가 고른 날짜·도착 시각에서 만들어진
    // **사용자 입력**이라 오늘 날짜의 미래 시각이 그대로 들어올 수 있다(그 경우 소급으로도
    // 판정되지 않는다). 미래 값을 그대로 저장하면 아래 가드가 스스로 잠겨, 그날 실제로
    // 적힌 비고들이 조용히 무시된다. 그래서 지금보다 미래면 지금으로 당긴다.
    const notedTime = new Date(Math.min(ts.getTime(), Date.now()));

    // 차량이 운행일지의 기관 소속인지 검증 후 갱신 (교차 테넌트 오염 차단 — currentKm과 같은 규칙)
    const vehSnap = await db.collection("vehicles").doc(vehId).get();
    const veh = vehSnap.data();
    if (!vehSnap.exists || veh?.organizationId !== orgId) {
        logger.warn(`[applyVehicleLastDriveNote] 차량 org 불일치 — 직전 비고 갱신 건너뜀: veh=${vehId}, org=${orgId}`);
        return;
    }

    // 더 최신 운행의 비고가 이미 올라와 있으면 덮지 않는다. `isEffectivelyRetroactive`는
    // "뒤에 다른 운행일지가 있는가"만 보므로, 뒤 기록이 없는 경로로 들어온 과거 운행을
    // 여기서 한 번 더 거른다(현재 위치·주유 필요와 같은 2차 방어선).
    const notedAt = veh?.lastDriveNoteAt;
    const notedDate = notedAt instanceof Date ? notedAt : notedAt?.toDate?.();
    if (notedDate instanceof Date && notedDate.getTime() > notedTime.getTime()) return;

    const stored = typeof veh?.lastDriveNote === "string" ? veh.lastDriveNote : "";
    const storedBy = typeof veh?.lastDriveNoteBy === "string" ? veh.lastDriveNoteBy : "";

    // 같은 이벤트가 다시 전달된 경우에만 건너뛴다 — 내용과 시각이 **모두** 같을 때다.
    //
    // 내용만 보고 건너뛰면 안 된다. 고정 주차면을 쓰는 기관은 매일 같은 비고("타워 3층 B-12")를
    // 적는데, 그때 시각 갱신까지 건너뛰면 `lastDriveNoteAt`이 첫날에 멈춘다. 화면의 신선도
    // 컷은 이 시각만 보므로 **매일 적고 있는데도 2주 뒤 예약 카드에서 비고가 사라진다.**
    // 그 전에도 메타 줄이 어제 적은 것을 2주 전 것으로 표시한다.
    if (stored === note && storedBy === by && notedDate?.getTime() === notedTime.getTime()) return;

    if (!note) {
        // 지울 것이 없으면 쓰지 않는다. 비고 없는 운행이 대부분이라, 이 조기 반환이 곧 쓰기 절약이다.
        if (!stored) return;
        await db.collection("vehicles").doc(vehId).update({
            lastDriveNote: FieldValue.delete(),
            lastDriveNoteBy: FieldValue.delete(),
            // 시각은 남긴다 — 지운 것도 "이 운행까지 반영했다"는 사실이고, 남겨 두어야 더 오래된
            // 운행이 뒤늦게 저장되며 지워진 비고를 되살리는 일을 위 신선도 가드가 막을 수 있다.
            lastDriveNoteAt: notedTime,
        });
        return;
    }

    await db.collection("vehicles").doc(vehId).update({
        lastDriveNote: note,
        lastDriveNoteBy: by,
        lastDriveNoteAt: notedTime,
    });
}

/**
 * 지워진 운행일지가 차량에 남긴 비고 사본을 함께 지운다.
 *
 * 비고에는 이용자 성함 같은 자유 입력이 섞인다. 관리자가 그것을 지우려고 운행일지를 삭제해도
 * 차량 문서의 사본은 남는데, 이 기능은 관리자 직접 수정 경로를 열지 않았으므로 **지울 수 있는
 * 사람이 아무도 없다.** 같은 차량에 새 운행이 들어와야만 덮인다(폐차·장기 미운행 차량은 영영).
 * 화면의 14일 컷은 보이지 않게 할 뿐 데이터를 지우지 않는다.
 *
 * 그 일지에서 온 사본일 때만 지운다 — 판정은 시각 일치다. 사본은 출처 일지의 `timestamp`를
 * 그대로 싣고 있어(미래 시각만 당겨진다) 다른 일지가 덮어쓴 뒤에는 시각이 어긋난다.
 */
async function clearVehicleLastDriveNoteOnDelete(
    orgId: string,
    vehId: string,
    ts: Date,
): Promise<void> {
    const vehSnap = await db.collection("vehicles").doc(vehId).get();
    const veh = vehSnap.data();
    if (!vehSnap.exists || veh?.organizationId !== orgId) return;
    if (typeof veh?.lastDriveNote !== "string" || !veh.lastDriveNote) return;

    const notedAt = veh?.lastDriveNoteAt;
    const notedDate = notedAt instanceof Date ? notedAt : notedAt?.toDate?.();
    // 시각이 정확히 같을 때만 지운다. 도착 시각을 미래로 적어 저장 때 당겨진 사본은 여기서
    // 어긋나 남는데, 그 경우는 다음 운행이 덮는다 — 남의 비고를 지우는 쪽이 더 나쁘다.
    if (!(notedDate instanceof Date) || notedDate.getTime() !== ts.getTime()) return;

    await db.collection("vehicles").doc(vehId).update({
        lastDriveNote: FieldValue.delete(),
        lastDriveNoteBy: FieldValue.delete(),
        // 시각은 남긴다 — 저장 쪽과 같은 이유다(더 오래된 운행이 되살리지 못하게).
        lastDriveNoteAt: notedDate,
    });
}

/**
 * 위치 갱신은 **누적 km·통계 회계와 분리해서** 실행한다.
 *
 * 두 트리거는 retry: false라 한 번 던지면 이벤트가 사라진다. 표시용 위치 갱신이 일시적
 * UNAVAILABLE로 실패했다고 바깥 catch까지 올라가면, 그 뒤에 있는 currentKm 차분과 기관 통계가
 * **통째로 유실된다.** 위치는 다음 운행이 다시 맞춰 주지만 회계는 스스로 복구되지 않는다.
 */
export async function applyVehicleCurrentSiteSafely(
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
        logger.error(`[${context}] 차량 현재 위치 갱신 실패 (km 동기화는 계속 진행):`, error);
        captureError(error, { context, vehId, orgId });
    }
}

/** 주유 필요 표시도 같은 이유로 회계와 분리한다(위 주석 참고). */
export async function applyVehicleNeedsRefuelSafely(
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
        logger.error(`[${context}] 주유 필요 표시 갱신 실패 (km 동기화는 계속 진행):`, error);
        captureError(error, { context, vehId, orgId });
    }
}

/**
 * 직전 비고도 같은 이유로 회계와 분리한다(위 주석 참고).
 *
 * Sentry 컨텍스트에 **비고 본문을 싣지 않는다.** 목적지·동승자 이름과 함께 비고는 자유 입력이라
 * 개인정보가 섞이는 자리이고, 프런트에서도 스크러빙 대상으로 다루고 있다. 식별자만 남긴다.
 */
export async function applyVehicleLastDriveNoteSafely(
    context: string,
    orgId: string,
    vehId: string,
    notes: unknown,
    driverName: unknown,
    ts: Date,
    isEffectivelyRetroactive: boolean,
): Promise<void> {
    try {
        await applyVehicleLastDriveNote(orgId, vehId, notes, driverName, ts, isEffectivelyRetroactive);
    } catch (error) {
        logger.error(`[${context}] 직전 비고 갱신 실패 (km 동기화는 계속 진행):`, error);
        captureError(error, { context, vehId, orgId });
    }
}

/** 삭제 쪽 비고 정리도 같은 이유로 회계와 분리한다(위 주석 참고). */
export async function clearVehicleLastDriveNoteSafely(
    context: string,
    orgId: string,
    vehId: string,
    ts: Date,
): Promise<void> {
    try {
        await clearVehicleLastDriveNoteOnDelete(orgId, vehId, ts);
    } catch (error) {
        logger.error(`[${context}] 직전 비고 정리 실패 (km 동기화는 계속 진행):`, error);
        captureError(error, { context, vehId, orgId });
    }
}
