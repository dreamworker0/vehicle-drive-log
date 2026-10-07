/**
 * syncHipassBalance — 충전 기록이 카드 잔액을 결정한다
 *
 * 잔액의 주인을 클라이언트에서 서버로 옮긴 세 트리거다. 왜 옮겼는지와 트랜잭션을 쓰는
 * 이유는 [applyBalanceDelta](../../services/hipass/applyBalanceDelta.ts)의 머리 주석에 있다.
 *
 * 운행일지의 하이패스 **사용**은 여기 없다 — 운행일지에는 이미 create/update/delete 트리거가
 * 있어([syncDriveLogKm](./syncDriveLogKm.ts)) 거기에 얹었다. 같은 문서에 트리거를 하나 더
 * 붙이면 쓰기마다 호출이 두 배가 된다.
 */
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { captureError } from "../../core/sentry";
import { log } from "../../utils/helpers";
import { applyBalanceDelta } from "../../services/hipass/applyBalanceDelta";

/** 문서에서 충전금액을 숫자로 읽는다. 숫자가 아니면 0 — 잔액을 NaN으로 만들지 않는다. */
function chargeAmountOf(data: Record<string, unknown> | undefined | null): number {
    const amount = data?.chargeAmount;
    if (typeof amount !== "number" || !Number.isFinite(amount)) return 0;
    return amount;
}

/** 충전 기록이 생기면 그만큼 잔액이 는다. */
export const onHipassChargeCreated = onDocumentCreated(
    { document: "hipassCharges/{chargeId}", region: "asia-northeast3", memory: "256MiB" },
    async (event) => {
        const data = event.data?.data();
        if (!data) return;
        try {
            await applyBalanceDelta(
                "onHipassChargeCreated",
                data.cardId as string | undefined,
                data.organizationId as string | undefined,
                chargeAmountOf(data),
            );
        } catch (error) {
            log("ERROR", "onHipassChargeCreated", "잔액 반영 중 오류", { chargeId: event.params.chargeId });
            captureError(error, { context: "onHipassChargeCreated", chargeId: event.params.chargeId });
        }
    },
);

/**
 * 기록이 고쳐지면 **차액만** 반영한다.
 *
 * 관리자가 직원의 충전 기록을 정정하는 경로가 있고(Phase 224), 종전에는 화면이 delta를
 * 계산해 카드에 직접 썼다. 그 계산을 여기로 옮긴 것이다.
 */
export const onHipassChargeUpdated = onDocumentUpdated(
    { document: "hipassCharges/{chargeId}", region: "asia-northeast3", memory: "256MiB" },
    async (event) => {
        const before = event.data?.before?.data();
        const after = event.data?.after?.data();
        if (!before || !after) return;
        try {
            const delta = chargeAmountOf(after) - chargeAmountOf(before);
            // 카드를 옮긴 정정(드문 경우)은 옛 카드에서 빼고 새 카드에 더한다 —
            // 차액만 반영하면 두 카드 모두 어긋난 채로 남는다.
            const oldCardId = before.cardId as string | undefined;
            const newCardId = after.cardId as string | undefined;
            if (oldCardId !== newCardId) {
                await applyBalanceDelta("onHipassChargeUpdated", oldCardId, before.organizationId as string | undefined, -chargeAmountOf(before));
                await applyBalanceDelta("onHipassChargeUpdated", newCardId, after.organizationId as string | undefined, chargeAmountOf(after));
                return;
            }
            await applyBalanceDelta("onHipassChargeUpdated", newCardId, after.organizationId as string | undefined, delta);
        } catch (error) {
            log("ERROR", "onHipassChargeUpdated", "잔액 반영 중 오류", { chargeId: event.params.chargeId });
            captureError(error, { context: "onHipassChargeUpdated", chargeId: event.params.chargeId });
        }
    },
);

/**
 * 기록이 지워지면 그만큼 잔액이 준다.
 *
 * 화면의 삭제 확인창이 "카드 잔액이 원래대로 되돌아갑니다"라고 약속하는 그 동작이다.
 * 종전에는 그 되돌리기를 클라이언트가 했고, 그래서 되돌리기만 실패하는 경우가 있었다
 * (Phase 225). 이제 기록이 지워지면 되돌리기도 함께 일어난다.
 */
export const onHipassChargeDeleted = onDocumentDeleted(
    { document: "hipassCharges/{chargeId}", region: "asia-northeast3", memory: "256MiB" },
    async (event) => {
        const data = event.data?.data();
        if (!data) return;
        try {
            await applyBalanceDelta(
                "onHipassChargeDeleted",
                data.cardId as string | undefined,
                data.organizationId as string | undefined,
                -chargeAmountOf(data),
            );
        } catch (error) {
            log("ERROR", "onHipassChargeDeleted", "잔액 반영 중 오류", { chargeId: event.params.chargeId });
            captureError(error, { context: "onHipassChargeDeleted", chargeId: event.params.chargeId });
        }
    },
);
