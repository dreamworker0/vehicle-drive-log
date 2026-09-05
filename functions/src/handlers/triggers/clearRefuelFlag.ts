import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { captureError } from "../../core/sentry";
import { getKSTDateString } from "../../utils/kstDate";

const db = getFirestore();

/**
 * 주유(충전)일지가 작성되면 그 차량의 "주유 필요" 표시를 끈다.
 *
 * 운행일지는 표시를 **켜기만** 한다(syncDriveLogKm의 applyVehicleNeedsRefuel) —
 * "연료가 부족했다"는 사실만 증언할 수 있고 그 뒤에 주유가 있었는지는 모르기 때문이다.
 * 끄는 근거는 여기, 실제로 주유했다는 기록이다.
 *
 * **자동 해제가 유일한 경로는 아니다.** 주유일지를 쓰지 않는 기관도 있어서, 관리자가
 * [차량 관리]에서 직접 끌 수 있는 경로를 함께 둔다. 자동만 두면 그 기관들은 영영 못 끈다.
 */
export const onFuelLogCreated = onDocumentCreated(
    { document: "fuelLogs/{logId}", region: "asia-northeast3", memory: "256MiB" },
    async (event) => {
        const snap = event.data;
        if (!snap) return;

        const data = snap.data();
        const orgId = data.organizationId;
        const vehId = data.vehicleId;
        if (!orgId || !vehId) return;

        try {
            // 차량이 이 주유일지의 기관 소속인지 검증 (교차 테넌트 오염 차단 — currentKm과 같은 규칙)
            const vehSnap = await db.collection("vehicles").doc(vehId).get();
            const veh = vehSnap.data();
            if (!vehSnap.exists || veh?.organizationId !== orgId) {
                console.warn(`[onFuelLogCreated] 차량 org 불일치 — 주유 필요 해제 건너뜀: veh=${vehId}, org=${orgId}`);
                return;
            }

            // 켜져 있지 않으면 쓸 일이 없다. 매 주유마다 false를 덮어쓰면 needsRefuelAt이
            // 실제로 상태가 바뀐 시각을 가리키지 못해 아래 신선도 판정이 무너진다.
            if (veh?.needsRefuel !== true) return;

            // **주유한 날**이 표시된 날보다 이전이면 끄지 않는다.
            //
            // 지난주 주유 영수증을 오늘 뒤늦게 입력하는 일이 있다. 그 기록으로 오늘 켜진
            // 표시를 끄면, 실제로는 연료가 부족한 차가 멀쩡해 보인다.
            // 같은 날이면 끈다 — 표시(14:00) 후 주유(15:00)가 가장 흔한 순서이고,
            // 날짜만 있는 주유일지로는 시:분을 비교할 수 없기 때문이다.
            const changedAt = veh?.needsRefuelAt;
            const changedDate = changedAt instanceof Date ? changedAt : changedAt?.toDate?.();
            const fueledOn = typeof data.date === "string" ? data.date : "";
            if (changedDate instanceof Date && fueledOn && fueledOn < getKSTDateString(changedDate)) return;

            await db.collection("vehicles").doc(vehId).update({
                needsRefuel: false,
                needsRefuelAt: FieldValue.serverTimestamp(),
            });
        } catch (error) {
            // 해제 실패는 주유 기록 자체를 되돌릴 이유가 되지 않는다. 표시가 남아 있으면
            // 관리자가 [차량 관리]에서 직접 끌 수 있다 — 복구 경로가 있는 실패다.
            console.error("[onFuelLogCreated] 주유 필요 표시 해제 실패:", error);
            captureError(error, { context: "onFuelLogCreated", vehId, orgId });
        }
    },
);
