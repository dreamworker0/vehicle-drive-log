/**
 * vehicleStatus — 외부 연동 API가 돌려주는 "차량별 현재 상태" 조립
 *
 * 내보내는 값은 의도적으로 좁다: 차량 이름·번호판·누적 주행거리·하이패스 잔액.
 * 운행 기록·예약·직원 정보처럼 **개인정보가 섞인 값은 내보내지 않는다.** 필드를 늘리려면
 * 이 파일의 응답 모양(계약)을 바꾸는 것이므로, 사용 안내(manualSections)와 함께 고친다.
 *
 * 하이패스 카드 번호는 끝 4자리만 준다 — 어느 카드인지 알아보기에는 충분하고,
 * 전체 번호가 기관 밖 스프레드시트에 남을 이유는 없다.
 */
import type { Firestore } from "firebase-admin/firestore";

export interface ExternalVehicleStatus {
    id: string;
    /** 화면에 보이는 차량 이름(표시 이름 → 모델명 순) */
    name: string;
    plateNumber: string;
    /** 누적 주행거리(km) — 운행일지 저장 시 서버 트리거가 갱신하는 값 */
    currentKm: number;
    /** 연결된 하이패스 카드의 현재 잔액(원). 카드가 없거나 기관이 하이패스를 끄면 null */
    hipassBalance: number | null;
    /** 연결된 하이패스 카드 번호 끝 4자리. 카드가 없으면 null */
    hipassCardLast4: string | null;
}

export interface ExternalVehicleStatusResponse {
    organizationName: string;
    /** 응답을 만든 시각(ISO 8601, UTC) */
    generatedAt: string;
    vehicles: ExternalVehicleStatus[];
}

function toNumber(value: unknown): number | null {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(n) ? n : null;
}

function last4(cardNumber: unknown): string | null {
    if (typeof cardNumber !== "string") return null;
    const digits = cardNumber.replace(/\D/g, "");
    return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * 기관의 운행 중인 차량 상태를 조립한다. 퇴역한 차량은 뺀다.
 *
 * @param hipassEnabled 기관이 하이패스 기능을 쓰는지(`hipassEnabled !== false`). 꺼져 있으면
 *   카드 컬렉션을 읽지 않고 잔액을 모두 null로 둔다.
 */
export async function buildVehicleStatus(
    db: Firestore,
    organizationId: string,
    organizationName: string,
    hipassEnabled: boolean,
    now: Date = new Date(),
): Promise<ExternalVehicleStatusResponse> {
    const [vehicleSnap, cardSnap] = await Promise.all([
        db.collection("vehicles").where("organizationId", "==", organizationId).get(),
        hipassEnabled
            ? db.collection("hipassCards").where("organizationId", "==", organizationId).get()
            : Promise.resolve(null),
    ]);

    // 차량 하나에 카드는 하나다(하이패스 관리 화면이 중복 연결을 막는다). 혹시 둘이면 먼저 읽힌 것을 쓴다.
    const cardByVehicle = new Map<string, { balance: number | null; last4: string | null }>();
    for (const doc of cardSnap?.docs ?? []) {
        const data = doc.data();
        const vehicleId = data.vehicleId;
        if (typeof vehicleId !== "string" || vehicleId === "" || cardByVehicle.has(vehicleId)) continue;
        cardByVehicle.set(vehicleId, { balance: toNumber(data.balance), last4: last4(data.cardNumber) });
    }

    const vehicles: ExternalVehicleStatus[] = [];
    for (const doc of vehicleSnap.docs) {
        const data = doc.data();
        if (data.retired?.isRetired === true) continue;
        const card = cardByVehicle.get(doc.id);
        const displayName = typeof data.displayName === "string" ? data.displayName.trim() : "";
        const modelName = typeof data.name === "string" ? data.name.trim() : "";
        vehicles.push({
            id: doc.id,
            name: displayName || modelName,
            plateNumber: typeof data.plateNumber === "string" ? data.plateNumber : "",
            currentKm: toNumber(data.currentKm) ?? 0,
            hipassBalance: card?.balance ?? null,
            hipassCardLast4: card?.last4 ?? null,
        });
    }
    vehicles.sort((a, b) => a.name.localeCompare(b.name, "ko"));

    return {
        organizationName,
        generatedAt: now.toISOString(),
        vehicles,
    };
}
