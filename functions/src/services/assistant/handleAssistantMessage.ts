/**
 * handleAssistantMessage — 메신저 어시스턴트 오케스트레이터
 *
 * 플랫폼 독립 코어(Slack/Google Chat 공용): 자연어 → 의도 파싱 → 조회/예약 제안.
 * 예약 생성은 오파싱 방지를 위해 즉시 실행하지 않고 confirmation(제안)으로 반환하며,
 * 어댑터가 사용자 확인(버튼 등)을 받은 뒤 executeReservationProposal로 실행한다.
 */
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { parseIntent, type AssistantVehicle } from "./parseIntent";
import { buildReservationSummary } from "./queryReservations";
import { createReservationTx } from "../reservation/createReservationCore";

const db = getFirestore();

export interface AssistantActor {
    uid: string;
    orgId: string;
    displayName: string;
}

/** 사용자 확인 후 실행할 예약 제안 — createReservationTx 입력의 부분집합 */
export interface ReservationProposal {
    organizationId: string;
    vehicleId: string;
    vehicleName: string;
    date: string;
    startTime: string;
    endTime: string;
    purpose: string;
    destination: string;
    actorUid: string;
    reservedByName: string;
}

export interface AssistantResult {
    replyText: string;
    /** 있으면 어댑터가 확인 UI(버튼 등)를 띄워야 한다 */
    proposal?: ReservationProposal;
}

export const ASSISTANT_HELP_TEXT =
    "제가 도와드릴 수 있는 일이에요:\n" +
    "• 예약 조회 — 예: \"오늘 예약 현황 알려줘\", \"내일 일정 보여줘\"\n" +
    "• 예약 생성 — 예: \"내일 14시부터 16시까지 스타렉스 예약해줘\"";

/** 기관의 예약 가능 차량 목록 조회 (퇴역 차량 제외) */
async function getAssistantVehicles(orgId: string): Promise<Array<AssistantVehicle & { isBlocked: boolean }>> {
    const snap = await db.collection("vehicles")
        .where("organizationId", "==", orgId)
        .get();

    return snap.docs
        .filter((doc) => doc.data().retired?.isRetired !== true)
        .map((doc) => ({
            id: doc.id,
            name: doc.data().displayName || doc.data().name || "이름 없음",
            isBlocked: doc.data().maintenance?.isBlocked === true,
        }));
}

/** 예약 제안 요약 텍스트 (확인 UI에 표시) */
export function formatProposalSummary(p: ReservationProposal): string {
    const extra = [p.destination && `목적지: ${p.destination}`, p.purpose && `용도: ${p.purpose}`]
        .filter(Boolean)
        .join(" / ");
    return `아래 내용으로 예약할까요?\n🚗 ${p.vehicleName}\n📅 ${p.date} ${p.startTime}~${p.endTime}\n👤 ${p.reservedByName}${extra ? `\n📝 ${extra}` : ""}`;
}

/** 자연어 메시지 처리 — 조회는 즉시 응답, 생성은 proposal 반환 */
export async function handleAssistantMessage(text: string, actor: AssistantActor): Promise<AssistantResult> {
    const vehicles = await getAssistantVehicles(actor.orgId);
    const intent = await parseIntent(text, vehicles);

    if (intent.intent === "query") {
        const replyText = await buildReservationSummary(actor.orgId, intent.date!);
        return { replyText };
    }

    if (intent.intent === "create") {
        if (intent.needsClarification) {
            return { replyText: intent.clarificationQuestion || ASSISTANT_HELP_TEXT };
        }

        const vehicle = vehicles.find((v) => v.id === intent.vehicleId)!;
        if (vehicle.isBlocked) {
            return { replyText: `🚫 ${vehicle.name}은(는) 현재 정비 중이라 예약할 수 없습니다.` };
        }

        const proposal: ReservationProposal = {
            organizationId: actor.orgId,
            vehicleId: vehicle.id,
            vehicleName: vehicle.name,
            date: intent.date!,
            startTime: intent.startTime!,
            endTime: intent.endTime!,
            purpose: intent.purpose,
            destination: intent.destination,
            actorUid: actor.uid,
            reservedByName: actor.displayName,
        };
        return { replyText: formatProposalSummary(proposal), proposal };
    }

    return { replyText: `무엇을 도와드릴까요?\n\n${ASSISTANT_HELP_TEXT}` };
}

/** 확인된 예약 제안 실행 — 결과를 사용자용 텍스트로 반환. source는 호출 플랫폼 식별자 */
export async function executeReservationProposal(proposal: ReservationProposal, source: string): Promise<string> {
    try {
        const { status } = await createReservationTx({
            ...proposal,
            actorOrgId: proposal.organizationId,
            source,
        });
        const statusText = status === "pending"
            ? "관리자 승인 대기 상태로 등록되었습니다. 승인되면 알림이 갑니다."
            : "예약이 확정되었습니다.";
        return `✅ ${proposal.vehicleName} ${proposal.date} ${proposal.startTime}~${proposal.endTime}\n${statusText}`;
    } catch (err) {
        if (err instanceof HttpsError) {
            // 코어의 한국어 에러 메시지를 그대로 사용자에게 전달 (예: "이미 예약되어 있습니다")
            return `❌ 예약에 실패했습니다: ${err.message}`;
        }
        throw err;
    }
}
