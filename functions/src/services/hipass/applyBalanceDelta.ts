/**
 * applyBalanceDelta — 하이패스 카드 잔액의 **서버 권위 반영**
 *
 * ## 왜 서버가 소유하는가
 *
 * 잔액은 원래 클라이언트가 계산해 절대값으로 덮어썼다. 쓰기 경로가 넷이었고(충전 ·
 * 충전기록 삭제 복원 · 관리자 정정 · 운행일지의 하이패스 사용), 그중 셋이
 * **화면에 로드된 값 기준의 read-modify-write**였다:
 *
 * ```ts
 * const before = selectedCard.balance;   // 오래됐을 수 있다
 * await updateHipassCard(id, { balance: before + amount });
 * ```
 *
 * 그래서 두 사람이 동시에 쓰면 한쪽 갱신이 통째로 유실됐고, Rules로는 "이 잔액이
 * 기록들의 합과 맞는가"를 판정할 수 없어 기관 구성원 누구나 임의의 값을 기록 없이
 * 덮을 수 있었다(2026-09-12 감사 부록). 두 문제의 뿌리가 같다 — **잔액의 주인이
 * 클라이언트였다는 것**이다.
 *
 * 이 저장소는 같은 모양의 문제를 이미 한 번 서버로 옮겼다. 차량 누적 주행거리
 * (`vehicles.currentKm`)는 `syncDriveLogKm`의 트리거가 `FieldValue.increment`로 소유한다.
 * 하이패스 잔액만 클라이언트에 남아 있었고, 그 자리가 Phase 214·224·225에서 반복해
 * 물린 곳이다.
 *
 * ## 왜 increment가 아니라 트랜잭션인가
 *
 * `FieldValue.increment`는 원자적이지만 **하한을 강제할 수 없다**. 잔액은 Rules와 화면이
 * 모두 `>= 0`을 전제하고(클라이언트도 `Math.max(0, …)`으로 막고 있었다), Admin SDK는
 * Rules를 우회하므로 여기서 지키지 않으면 지킬 곳이 없다. 읽고-더하고-바닥을 치는 일을
 * 트랜잭션 안에서 하면 원자성과 하한을 함께 얻는다. 이 경로는 호출량이 적어(운행일지의
 * 하이패스 사용 · 충전 기록) 트랜잭션 비용이 문제되지 않는다.
 *
 * ## 재시도와 중복 반영
 *
 * v2 백그라운드 트리거는 `retry` 옵션을 켜야만 실패를 재시도한다. 이 트리거들은 켜지 않으므로
 * **재시도로 인한 중복 반영은 없다.** 다만 Eventarc 전달 자체는 at-least-once라 성공한
 * 이벤트가 드물게 두 번 올 수 있고, `retry: false`가 그것까지 막지는 않는다. 증분 반영에는
 * 멱등 장치가 없으므로, 그 확률을 감수할 수 없게 되면 **여기에 멱등성 표시가 필요하다**
 * (같은 저장소의 `auditLog`는 반대로 `retry: true` + 멱등 문서 ID 조합을 쓴다).
 */
import { getFirestore } from "firebase-admin/firestore";
import { log } from "../../utils/helpers";

const db = getFirestore();

/** 잔액 반영 결과 — 호출부가 로그로만 쓰고 흐름을 바꾸지는 않는다. */
export type BalanceDeltaOutcome =
    | { applied: true; before: number; after: number }
    | { applied: false; reason: "no-delta" | "no-card" | "card-missing" | "org-mismatch" | "write-failed" };

/**
 * 카드 잔액에 delta를 더한다(음수면 뺀다). 0 미만으로는 내려가지 않는다.
 *
 * @param context  로그 식별용 호출부 이름
 * @param cardId   대상 카드 문서 ID
 * @param orgId    기록이 속한 기관 — 카드의 기관과 다르면 **반영하지 않는다**
 *                 (교차 테넌트 잔액 오염 차단. `syncDriveLogKm`의 차량 org 검증과 같은 이유)
 * @param delta    더할 금액
 */
export async function applyBalanceDelta(
    context: string,
    cardId: string | undefined | null,
    orgId: string | undefined | null,
    delta: number,
): Promise<BalanceDeltaOutcome> {
    if (!Number.isFinite(delta) || delta === 0) return { applied: false, reason: "no-delta" };
    if (!cardId || !orgId) return { applied: false, reason: "no-card" };

    try {
        return await db.runTransaction(async (tx) => {
            const ref = db.collection("hipassCards").doc(cardId);
            const snap = await tx.get(ref);

            // 카드가 이미 지워졌을 수 있다(충전 기록만 남은 상태). 되돌릴 곳이 없으면 조용히 넘어가되
            // 흔적은 남긴다 — 화면은 "잔액이 되돌아갑니다"라고 약속했으므로 말과 실제가 갈린 순간이다.
            if (!snap.exists) {
                log("WARNING", context, "하이패스 카드가 없어 잔액을 반영하지 못했다", { cardId, orgId, delta });
                return { applied: false, reason: "card-missing" } as const;
            }

            const card = snap.data() ?? {};
            if (card.organizationId !== orgId) {
                log("WARNING", context, "카드와 기록의 기관이 달라 잔액 반영을 건너뛴다", {
                    cardId, cardOrg: card.organizationId, recordOrg: orgId,
                });
                return { applied: false, reason: "org-mismatch" } as const;
            }

            const before = typeof card.balance === "number" && Number.isFinite(card.balance) ? card.balance : 0;
            const after = Math.max(0, before + delta);
            tx.update(ref, { balance: after });
            return { applied: true, before, after } as const;
        });
    } catch (err) {
        // 잔액 반영 실패가 기록 저장을 되돌리지는 않는다 — 기록이 정본이고 잔액은 그 파생이다.
        // 다만 조용히 어긋나면 아무도 모르므로 반드시 올린다.
        // log("ERROR", ...)가 이미 Sentry로 올린다(helpers.log) — captureError를 겹쳐 부르면
        // 같은 실패가 두 건으로 쌓인다.
        log("ERROR", context, "하이패스 잔액 반영 실패", {
            cardId, orgId, delta, error: (err as Error).message,
        });
        return { applied: false, reason: "write-failed" };
    }
}

/**
 * 운행일지 한 건이 쓴 하이패스 사용액.
 *
 * 두 값이 **모두 숫자일 때만** 사용으로 본다. 한쪽만 있는 기록은 하이패스를 쓰지 않은
 * 운행이거나 입력이 덜 된 것이라, 없는 값을 0으로 보면 잔액을 통째로 깎는다.
 */
export function usedAmountOf(data: Record<string, unknown> | undefined | null): number {
    if (!data) return 0;
    const before = data.hipassBalanceBefore;
    const after = data.hipassBalanceAfter;
    if (typeof before !== "number" || typeof after !== "number") return 0;
    if (!Number.isFinite(before) || !Number.isFinite(after)) return 0;
    const used = before - after;
    if (!Number.isFinite(used)) return 0;
    // **음수 사용액은 반영하지 않는다.** 사용액이 음수라는 것은 통행료를 쓰고 잔액이
    // 늘었다는 뜻이라 실제로는 불가능하다. Rules가 `after <= before`로 먼저 막지만,
    // 옛 기록·서버 경로(Admin SDK는 Rules를 우회한다)로 들어올 수 있어 여기서도 끊는다 —
    // 막지 않으면 운행일지 한 건으로 카드 잔액을 임의로 불릴 수 있다.
    return used > 0 ? used : 0;
}

/**
 * 이 수정에서 하이패스 기록이 **사라졌는가**.
 *
 * `createDriveLog`는 결정론적 ID로 `setDoc`(merge 아님)한다. 같은 운행을 다시 저장할 때
 * 카드 조회가 실패했거나 사용후 금액 칸이 비어 있으면 하이패스 필드가 문서에서 통째로
 * 빠지는데, 그러면 `usedAmountOf(after)`가 0이 되어 **실제로 쓴 돈이 환불된다.**
 * `usedAmountOf`만으로는 "0원 사용"과 "필드 소멸"을 구분할 수 없어 따로 본다.
 */
export function hipassFieldsDropped(
    before: Record<string, unknown> | undefined | null,
    after: Record<string, unknown> | undefined | null,
): boolean {
    const had = typeof before?.hipassBalanceBefore === "number" && typeof before?.hipassBalanceAfter === "number";
    const has = typeof after?.hipassBalanceBefore === "number" && typeof after?.hipassBalanceAfter === "number";
    return had && !has;
}

/**
 * 운행일지의 차량에 연결된 하이패스 카드를 찾는다.
 *
 * 운행일지는 카드 ID를 저장하지 않는다(`hipassCardNumber`는 표시용 문자열이다). 화면이
 * 카드를 고르는 규칙이 `기관 + 차량`이므로(`useDriveLogInitializer`의
 * `cards.find(c => c.vehicleId === form.vehicleId)`) 서버도 **같은 규칙**을 쓴다.
 *
 * **다만 카드가 하나일 때만 같다.** 화면은 `find`라 목록의 첫 카드를 집는 반면 여기서는
 * 둘 이상이면 **아무것도 고르지 않는다**. 잘못된 카드를 깎는 것보다 안 깎고 경고를 남기는
 * 쪽이 낫다고 봤다(등록 화면이 중복 연결을 막지만 Rules가 강제하지는 않는다). 그 상태에서는
 * 기록과 잔액이 어긋난 채 남으므로, WARNING이 뜨면 카드 연결을 정리해야 한다.
 */
export async function findCardIdForVehicle(
    context: string,
    orgId: string | undefined | null,
    vehicleId: string | undefined | null,
): Promise<string | null> {
    if (!orgId || !vehicleId) return null;
    const snap = await db.collection("hipassCards")
        .where("organizationId", "==", orgId)
        .where("vehicleId", "==", vehicleId)
        .limit(2)
        .get();

    if (snap.empty) return null;
    if (snap.size > 1) {
        log("WARNING", context, "한 차량에 하이패스 카드가 둘 이상이라 잔액 반영을 건너뛴다", { orgId, vehicleId });
        return null;
    }
    return snap.docs[0].id;
}

/**
 * 운행일지의 하이패스 사용액 변화를 카드 잔액에 반영한다.
 *
 * **이 함수는 절대 던지지 않는다.** 운행일지 트리거의 바깥 try 안에서, 그것도 맨 앞에서
 * 불리기 때문이다. 카드 조회가 일시적 UNAVAILABLE로 실패했다고 예외가 위로 올라가면
 * 그 뒤에 있는 **차량 누적 km 차분·startKm 연쇄 재정합·기관 통계가 통째로 유실된다**
 * (트리거는 retry: false라 이벤트 재전달도 없다). 같은 이유로 위치·주유 표시 갱신이
 * `applyVehicleCurrentSiteSafely`/`applyVehicleNeedsRefuelSafely`로 격리돼 있고,
 * 이 함수는 그 규약을 함수 안에 들고 있는 형태다.
 *
 * 잔액은 다음 충전·사용 기록이 다시 맞춰 주지 못한다(증분이라 한 번 놓치면 어긋난 채
 * 남는다). 그래도 회계 전체를 잃는 것보다는 잔액 하나가 어긋나고 **경보가 남는** 쪽이 낫다.
 *
 * @param usedDelta 사용액의 증가분. 사용이 늘면 잔액은 그만큼 **줄어든다**.
 */
export async function applyDriveLogHipassDelta(
    context: string,
    orgId: string | undefined | null,
    vehicleId: string | undefined | null,
    usedDelta: number,
): Promise<void> {
    if (!Number.isFinite(usedDelta) || usedDelta === 0) return;
    try {
        const cardId = await findCardIdForVehicle(context, orgId, vehicleId);
        if (!cardId) return;
        await applyBalanceDelta(context, cardId, orgId, -usedDelta);
    } catch (err) {
        log("ERROR", context, "하이패스 사용액 반영 실패 (km 동기화는 계속 진행)", {
            orgId, vehicleId, usedDelta, error: (err as Error).message,
        });
    }
}
