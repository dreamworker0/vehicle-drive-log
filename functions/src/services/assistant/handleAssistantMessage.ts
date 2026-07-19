/**
 * handleAssistantMessage — 메신저 어시스턴트 오케스트레이터
 *
 * 플랫폼 독립 코어(Slack/Google Chat 공용): 자연어 → 의도 파싱 → 조회/예약 제안.
 * 예약 생성은 오파싱 방지를 위해 즉시 실행하지 않고 confirmation(제안)으로 반환하며,
 * 어댑터가 사용자 확인(버튼 등)을 받은 뒤 executeReservationProposal로 실행한다.
 */
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { parseIntent, type AssistantVehicle, type PendingSlots } from "./parseIntent";
import { buildReservationSummary } from "./queryReservations";
import { answerDataQuestion } from "./answerDataQuestion";
import { findCancelCandidates, type CancelCandidate } from "./cancelReservation";
import { createReservationTx } from "../reservation/createReservationCore";
import { cancelReservationTx } from "../reservation/cancelReservationCore";

const db = getFirestore();

/** 멀티턴 대화 상태 유효기간 — 초과 시 진행 중 예약을 폐기 (TTL 정책으로 자동 삭제) */
const CONVERSATION_TTL_MS = 10 * 60 * 1000;

export interface AssistantActor {
    uid: string;
    orgId: string;
    displayName: string;
    /** 멀티턴 대화 상태 키 (플랫폼별 사용자 식별자, 예: slack_{team}_{user}). 없으면 무상태 */
    conversationKey?: string;
}

/** 진행 중인 예약 슬롯을 로드 (만료분은 무시) */
async function loadPending(key: string): Promise<PendingSlots | null> {
    const snap = await db.collection("assistantConversations").doc(key).get();
    if (!snap.exists) return null;
    const data = snap.data()!;
    const expiresAt: Date | null = data.expiresAt?.toDate ? data.expiresAt.toDate() : null;
    if (!expiresAt || expiresAt.getTime() < Date.now()) return null;
    const s = data.slots || {};
    return {
        date: s.date ?? null,
        startTime: s.startTime ?? null,
        endTime: s.endTime ?? null,
        vehicleId: s.vehicleId ?? null,
        purpose: s.purpose ?? "",
        destination: s.destination ?? "",
    };
}

async function savePending(key: string, orgId: string, slots: PendingSlots): Promise<void> {
    await db.collection("assistantConversations").doc(key).set({
        orgId,
        slots,
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
    });
}

async function clearPending(key: string): Promise<void> {
    await db.collection("assistantConversations").doc(key).delete().catch(() => undefined);
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

/** 사용자 확인 후 실행할 예약 취소 제안 — cancelReservationTx 입력 + 표시용 필드 */
export interface CancelProposal {
    reservationId: string;
    organizationId: string;
    actorUid: string;
    vehicleName: string;
    date: string;
    startTime: string;
    endTime: string;
}

export interface AssistantResult {
    replyText: string;
    /** 있으면 어댑터가 예약 생성 확인 UI(버튼 등)를 띄워야 한다 */
    proposal?: ReservationProposal;
    /** 있으면 어댑터가 예약 취소 확인 UI(버튼 등)를 띄워야 한다 */
    cancelProposal?: CancelProposal;
}

export const ASSISTANT_HELP_TEXT =
    "제가 도와드릴 수 있는 일이에요:\n" +
    "• 예약 조회 — 예: \"오늘 예약 현황 알려줘\", \"내일 일정 보여줘\"\n" +
    "• 예약 생성 — 예: \"내일 14시부터 16시까지 스타렉스 예약해줘\"\n" +
    "• 예약 취소 — 예: \"내일 스타렉스 예약 취소해줘\"\n" +
    "• 자유 질문 — 예: \"홍길동이 예약한 차\", \"이번주 예약 누가 했어\", \"우리 기관 차량 뭐 있어\"";

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

/** 취소 제안 요약 텍스트 (확인 UI에 표시) */
export function formatCancelSummary(c: CancelProposal): string {
    return `아래 예약을 취소할까요?\n🚗 ${c.vehicleName}\n📅 ${c.date} ${c.startTime}~${c.endTime}`;
}

/** 취소 후보가 여러 건일 때 되묻는 목록 텍스트 */
export function formatCancelCandidates(list: CancelCandidate[]): string {
    const lines = list.map((c, i) => `${i + 1}) 🚗 ${c.vehicleName} 📅 ${c.date} ${c.startTime}~${c.endTime}`);
    return `취소할 예약이 여러 건이에요. 어느 건인지 날짜·시간을 함께 알려주세요:\n${lines.join("\n")}`;
}

/** 자연어 메시지 처리 — 조회는 즉시 응답, 생성은 proposal 반환. 멀티턴 대화 상태 유지 */
export async function handleAssistantMessage(text: string, actor: AssistantActor): Promise<AssistantResult> {
    const key = actor.conversationKey;
    const vehicles = await getAssistantVehicles(actor.orgId);
    // 진행 중인 예약이 있으면 이번 메시지와 병합해 이어받는다
    const pending = key ? await loadPending(key) : null;
    const intent = await parseIntent(text, vehicles, pending || undefined);

    if (intent.intent === "query") {
        if (key) await clearPending(key); // 조회로 전환 → 진행 중 예약 폐기
        const replyText = await buildReservationSummary(actor.orgId, intent.date!);
        return { replyText };
    }

    if (intent.intent === "qa") {
        if (key) await clearPending(key); // 자유 질의로 전환 → 진행 중 예약 폐기
        const replyText = await answerDataQuestion(text, actor.orgId, vehicles);
        return { replyText };
    }

    if (intent.intent === "cancel") {
        if (key) await clearPending(key); // 취소로 전환 → 진행 중 예약 폐기
        const candidates = await findCancelCandidates(actor.orgId, actor.uid, {
            date: intent.date,
            vehicleId: intent.vehicleId,
            startTime: intent.startTime,
        });

        if (candidates.length === 0) {
            return {
                replyText:
                    "취소할 예약을 찾지 못했습니다. 본인이 예약한 예정된 건만 취소할 수 있어요. 날짜·차량을 함께 알려주시면 찾기 쉬워요.",
            };
        }

        if (candidates.length > 1) {
            // 여러 건 → 되묻기 (상태 저장 없이, 사용자가 시간을 더해 다시 요청)
            return { replyText: formatCancelCandidates(candidates) };
        }

        const c = candidates[0];
        const cancelProposal: CancelProposal = {
            reservationId: c.id,
            organizationId: actor.orgId,
            actorUid: actor.uid,
            vehicleName: c.vehicleName,
            date: c.date,
            startTime: c.startTime,
            endTime: c.endTime,
        };
        return { replyText: formatCancelSummary(cancelProposal), cancelProposal };
    }

    if (intent.intent === "create") {
        if (intent.needsClarification) {
            // 지금까지 모은 슬롯을 저장해 다음 메시지에서 이어받게 한다
            if (key) {
                await savePending(key, actor.orgId, {
                    date: intent.date,
                    startTime: intent.startTime,
                    endTime: intent.endTime,
                    vehicleId: intent.vehicleId,
                    purpose: intent.purpose,
                    destination: intent.destination,
                });
            }
            return { replyText: intent.clarificationQuestion || ASSISTANT_HELP_TEXT };
        }

        const vehicle = vehicles.find((v) => v.id === intent.vehicleId)!;
        if (vehicle.isBlocked) {
            if (key) await clearPending(key);
            return { replyText: `🚫 ${vehicle.name}은(는) 현재 정비 중이라 예약할 수 없습니다.` };
        }

        if (key) await clearPending(key); // 제안 단계로 넘어가면 슬롯 채우기 상태는 종료
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

    if (key) await clearPending(key);
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

/** 확인된 예약 취소 제안 실행 — 결과를 사용자용 텍스트로 반환 */
export async function executeCancelProposal(proposal: CancelProposal, _source: string): Promise<string> {
    try {
        await cancelReservationTx({
            reservationId: proposal.reservationId,
            actorUid: proposal.actorUid,
            actorOrgId: proposal.organizationId,
        });
        return `🚫 ${proposal.vehicleName} ${proposal.date} ${proposal.startTime}~${proposal.endTime}\n예약을 취소했습니다.`;
    } catch (err) {
        if (err instanceof HttpsError) {
            // 코어의 한국어 에러 메시지를 그대로 전달 (예: "이미 취소된 예약입니다")
            return `❌ 예약 취소에 실패했습니다: ${err.message}`;
        }
        throw err;
    }
}
