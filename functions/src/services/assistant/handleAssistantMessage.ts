/**
 * handleAssistantMessage — 메신저 어시스턴트 오케스트레이터
 *
 * 플랫폼 독립 코어(Slack/Google Chat 공용): 자연어 → 의도 파싱 → 조회/예약 제안.
 * 예약 생성은 오파싱 방지를 위해 즉시 실행하지 않고 confirmation(제안)으로 반환하며,
 * 어댑터가 사용자 확인(버튼 등)을 받은 뒤 executeReservationProposal로 실행한다.
 */
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { parseIntent, getSeoulNow, type AssistantVehicle, type PendingSlots } from "./parseIntent";
import { buildReservationSummary } from "./queryReservations";
import { answerDataQuestion } from "./answerDataQuestion";
import { findCancelCandidates, type CancelCandidate } from "./cancelReservation";
import { createReservationTx } from "../reservation/createReservationCore";
import { cancelReservationTx } from "../reservation/cancelReservationCore";
import { modifyReservationTx } from "../reservation/modifyReservationCore";
import { estimateOneWayDurationMin, calcEndTimeFromDuration } from "../tmap/routeEstimate";

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

/** modify 되묻기에서 사용자가 후보를 고를 때까지 유지할 새 값 */
interface ModifyNewValues {
    newDate: string | null;
    newStartTime: string | null;
    newEndTime: string | null;
    newVehicleId: string | null;
}

/** 진행 중인 수정 되묻기 상태 — 새 값 + N건 후보 목록 */
interface ModifyPending {
    newValues: ModifyNewValues;
    candidates: CancelCandidate[];
}

/** 진행 중인 대화 상태 — 예약 생성(슬롯 채우기) 또는 예약 수정(후보 고르기) */
type Pending =
    | { kind: "create"; slots: PendingSlots }
    | { kind: "modify"; modify: ModifyPending };

/** 진행 중인 대화 상태를 로드 (만료분은 무시) */
async function loadPending(key: string): Promise<Pending | null> {
    const snap = await db.collection("assistantConversations").doc(key).get();
    if (!snap.exists) return null;
    const data = snap.data()!;
    const expiresAt: Date | null = data.expiresAt?.toDate ? data.expiresAt.toDate() : null;
    if (!expiresAt || expiresAt.getTime() < Date.now()) return null;
    if (data.kind === "modify" && data.modify) {
        return { kind: "modify", modify: data.modify as ModifyPending };
    }
    // 하위 호환: kind 없이 slots만 있던 문서도 create로 취급
    if (data.slots) {
        const s = data.slots;
        return {
            kind: "create",
            slots: {
                date: s.date ?? null,
                startTime: s.startTime ?? null,
                endTime: s.endTime ?? null,
                vehicleId: s.vehicleId ?? null,
                purpose: s.purpose ?? "",
                destination: s.destination ?? "",
            },
        };
    }
    return null;
}

async function savePending(key: string, orgId: string, slots: PendingSlots): Promise<void> {
    await db.collection("assistantConversations").doc(key).set({
        kind: "create",
        orgId,
        slots,
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
    });
}

async function saveModifyPending(key: string, orgId: string, modify: ModifyPending): Promise<void> {
    await db.collection("assistantConversations").doc(key).set({
        kind: "modify",
        orgId,
        modify,
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
    });
}

async function clearPending(key: string): Promise<void> {
    await db.collection("assistantConversations").doc(key).delete().catch(() => undefined);
}

/**
 * 수정 되묻기 상태에서, 사용자의 후속 메시지를 후보 선택으로 해석한다.
 * 서수("3번"·순수 숫자)·차량명 부분일치·시작시각으로 좁힌다. LLM 재호출 없음.
 * @returns 매칭된 후보들 (1건=확정, 여러 건=여전히 모호, 0건=선택 아님)
 */
function resolveModifySelection(text: string, candidates: CancelCandidate[]): CancelCandidate[] {
    const t = text.toLowerCase();

    // 1) 서수/번호: "3번" 또는 메시지가 순수 숫자
    const trimmed = t.trim();
    const ordinal = /(\d+)\s*번/.exec(t) ?? (/^\d+$/.test(trimmed) ? [trimmed, trimmed] : null);
    if (ordinal) {
        const idx = parseInt(ordinal[1], 10) - 1;
        if (idx >= 0 && idx < candidates.length) return [candidates[idx]];
    }

    // 2) 차량명 부분일치
    const byVehicle = candidates.filter((c) => c.vehicleName && t.includes(c.vehicleName.toLowerCase()));
    if (byVehicle.length === 1) return byVehicle;

    // 3) 같은 차량 여러 건 → 시작시각(시 단위)으로 추가 필터
    const pool = byVehicle.length > 1 ? byVehicle : candidates;
    const byTime = pool.filter((c) => {
        const hour = c.startTime.split(":")[0];
        return hour && (t.includes(`${hour}시`) || t.includes(c.startTime));
    });
    if (byTime.length === 1) return byTime;

    // 차량명은 맞았으나 시간까지 모호하면 그 집합을 반환(재되묻기), 아니면 시간 매칭 결과
    return byVehicle.length > 1 ? byVehicle : byTime;
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

/** 사용자 확인 후 실행할 예약 수정 제안 — modifyReservationTx 입력(최종값) + 변경 전 표시용 */
export interface ModifyProposal {
    reservationId: string;
    organizationId: string;
    actorUid: string;
    vehicleName: string;
    /** 변경 후 최종 값 (코어가 적용) */
    date: string;
    startTime: string;
    endTime: string;
    /** 변경 전 값 (확인 UI 표시용) */
    beforeDate: string;
    beforeStartTime: string;
    beforeEndTime: string;
}

export interface AssistantResult {
    replyText: string;
    /** 있으면 어댑터가 예약 생성 확인 UI(버튼 등)를 띄워야 한다 */
    proposal?: ReservationProposal;
    /** 있으면 어댑터가 예약 취소 확인 UI(버튼 등)를 띄워야 한다 */
    cancelProposal?: CancelProposal;
    /** 있으면 어댑터가 예약 수정 확인 UI(버튼 등)를 띄워야 한다 */
    modifyProposal?: ModifyProposal;
}

export const ASSISTANT_HELP_TEXT =
    "제가 도와드릴 수 있는 일이에요:\n" +
    "• 예약 조회 — 예: \"오늘 예약 현황 알려줘\", \"내일 일정 보여줘\"\n" +
    "• 예약 생성 — 예: \"내일 14시 스타렉스로 서울역 예약해줘\" (목적지를 넣으면 종료 시간 자동)\n" +
    "• 예약 취소 — 예: \"내일 스타렉스 예약 취소해줘\"\n" +
    "• 예약 수정 — 예: \"내일 스타렉스 예약을 15시로 옮겨줘\"\n" +
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

/** 기관 주소 조회 (TMAP 출발지). 미등록이면 undefined → 종료 시간 되묻기로 폴백 */
async function getOrgAddress(orgId: string): Promise<string | undefined> {
    const snap = await db.collection("organizations").doc(orgId).get();
    return snap.exists ? (snap.data()?.address as string | undefined) : undefined;
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

/** 수정 후보가 여러 건일 때 되묻는 목록 텍스트 */
export function formatModifyCandidates(list: CancelCandidate[]): string {
    const lines = list.map((c, i) => `${i + 1}) 🚗 ${c.vehicleName} 📅 ${c.date} ${c.startTime}~${c.endTime}`);
    return `수정할 예약이 여러 건이에요. 어느 건인지 날짜·시간을 함께 알려주세요:\n${lines.join("\n")}`;
}

/** 수정 제안 요약 텍스트 (변경 전 → 변경 후, 확인 UI에 표시) */
export function formatModifySummary(p: ModifyProposal): string {
    const before = `${p.beforeDate} ${p.beforeStartTime}~${p.beforeEndTime}`;
    const after = `${p.date} ${p.startTime}~${p.endTime}`;
    return `아래와 같이 예약을 변경할까요?\n🚗 ${p.vehicleName}\n📅 ${before}\n⬇️\n📅 ${after}`;
}

/** "HH:MM"을 분 단위 정수로 변환 */
function toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
}

/** 분 단위 정수를 "HH:MM"으로 변환 (0~1439 범위 가정) */
function fromMinutes(total: number): string {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 대상 예약 + 새 값으로 수정 결과(제안 또는 안내)를 만든다.
 * 단건 확정 경로와 되묻기 후 선택 경로가 공유한다.
 */
function buildModifyResult(
    target: CancelCandidate,
    nv: ModifyNewValues,
    actor: AssistantActor,
    vehicles: Array<AssistantVehicle & { isBlocked: boolean }>,
): AssistantResult {
    // 차량 자체를 바꾸는 요청은 채팅 미지원(캘린더 크로스무브 등) — 앱으로 안내.
    // 대상과 다른 차량을 지목한 경우에만 우회한다(오파싱 오탐 방지).
    if (nv.newVehicleId && nv.newVehicleId !== target.vehicleId) {
        const newVehicle = vehicles.find((v) => v.id === nv.newVehicleId);
        return {
            replyText:
                `🔁 예약 차량 변경(${target.vehicleName} → ${newVehicle?.name ?? "다른 차량"})은 앱에서 해주세요. ` +
                "여기서는 예약의 날짜·시간 변경만 도와드릴 수 있어요.",
        };
    }

    // 새 값 계산: 제공값 우선, 없으면 기존값 유지. 새 시작만 주면 원래 소요시간 유지(shift).
    const newDate = nv.newDate ?? target.date;
    const newStartTime = nv.newStartTime ?? target.startTime;
    let newEndTime: string;
    if (nv.newEndTime) {
        newEndTime = nv.newEndTime;
    } else if (nv.newStartTime) {
        const durationMin = toMinutes(target.endTime) - toMinutes(target.startTime);
        const endMin = toMinutes(newStartTime) + durationMin;
        if (endMin >= 24 * 60) {
            return { replyText: "변경하면 종료 시간이 자정을 넘어갑니다. 종료 시간을 함께 알려주세요." };
        }
        newEndTime = fromMinutes(endMin);
    } else {
        newEndTime = target.endTime;
    }

    if (newDate === target.date && newStartTime === target.startTime && newEndTime === target.endTime) {
        return {
            replyText:
                "무엇을 어떻게 바꿀지 알려주세요. 예: \"15시로 옮겨줘\", \"14시~16시로 바꿔줘\", \"금요일로 미뤄줘\"",
        };
    }
    const seoulToday = getSeoulNow().date;
    if (newDate < seoulToday) {
        return { replyText: `지난 날짜(${newDate})로는 변경할 수 없습니다. 오늘(${seoulToday}) 이후로 알려주세요.` };
    }
    if (newStartTime >= newEndTime) {
        return { replyText: "시작 시간이 종료 시간보다 빨라야 합니다. 시간을 다시 알려주세요." };
    }

    const modifyProposal: ModifyProposal = {
        reservationId: target.id,
        organizationId: actor.orgId,
        actorUid: actor.uid,
        vehicleName: target.vehicleName,
        date: newDate,
        startTime: newStartTime,
        endTime: newEndTime,
        beforeDate: target.date,
        beforeStartTime: target.startTime,
        beforeEndTime: target.endTime,
    };
    return { replyText: formatModifySummary(modifyProposal), modifyProposal };
}

/** 자연어 메시지 처리 — 조회는 즉시 응답, 생성은 proposal 반환. 멀티턴 대화 상태 유지 */
export async function handleAssistantMessage(text: string, actor: AssistantActor): Promise<AssistantResult> {
    const key = actor.conversationKey;
    const vehicles = await getAssistantVehicles(actor.orgId);
    const pending = key ? await loadPending(key) : null;

    // 진행 중인 '수정 되묻기'가 있으면 이번 메시지를 후보 선택으로 해석한다
    if (pending?.kind === "modify") {
        const matched = resolveModifySelection(text, pending.modify.candidates);
        if (matched.length === 1) {
            if (key) await clearPending(key);
            return buildModifyResult(matched[0], pending.modify.newValues, actor, vehicles);
        }
        if (matched.length > 1) {
            // 여전히 모호 → 좁힌 목록으로 다시 되묻기 (상태 유지·TTL 갱신)
            if (key) await saveModifyPending(key, actor.orgId, { ...pending.modify, candidates: matched });
            return { replyText: formatModifyCandidates(matched) };
        }
        // 매칭 0건 → 사용자가 주제를 바꿈. 수정 되묻기를 폐기하고 아래에서 새로 파싱한다.
        if (key) await clearPending(key);
    }

    // 진행 중인 예약 생성 슬롯이 있으면 이번 메시지와 병합해 이어받는다
    const createSlots = pending?.kind === "create" ? pending.slots : undefined;
    const intent = await parseIntent(text, vehicles, createSlots);

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

    if (intent.intent === "modify") {
        if (key) await clearPending(key); // 진행 중이던 생성 슬롯 등은 폐기하고 수정 시작
        // 대상 특정은 취소와 동일한 후보 조회를 재사용 (단서: date·vehicleId·startTime)
        const candidates = await findCancelCandidates(actor.orgId, actor.uid, {
            date: intent.date,
            vehicleId: intent.vehicleId,
            startTime: intent.startTime,
        });

        if (candidates.length === 0) {
            return {
                replyText:
                    "수정할 예약을 찾지 못했습니다. 본인이 예약한 예정된 건만 수정할 수 있어요. 날짜·차량을 함께 알려주시면 찾기 쉬워요.",
            };
        }

        const newValues: ModifyNewValues = {
            newDate: intent.newDate,
            newStartTime: intent.newStartTime,
            newEndTime: intent.newEndTime,
            newVehicleId: intent.newVehicleId,
        };

        if (candidates.length > 1) {
            // 여러 건 → 새 값과 후보를 저장해, 다음 메시지(차량명·번호)에서 이어받아 확정한다
            if (key) await saveModifyPending(key, actor.orgId, { newValues, candidates });
            return { replyText: formatModifyCandidates(candidates) };
        }

        return buildModifyResult(candidates[0], newValues, actor, vehicles);
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

        // 종료 시간 결정: 사용자가 명시했으면 사용, 없으면 목적지 기반 TMAP 이동시간으로 자동 계산.
        // 계산 실패(기관 주소 미등록·지오코딩 실패·TMAP 오류) 시 종료 시간을 되묻는다.
        let endTime = intent.endTime;
        if (!endTime) {
            const orgAddress = await getOrgAddress(actor.orgId);
            const durationMin = await estimateOneWayDurationMin(orgAddress, intent.destination);
            if (durationMin != null) {
                endTime = calcEndTimeFromDuration(intent.startTime!, durationMin);
            } else {
                // 슬롯을 저장해 다음 메시지(종료 시간)에서 이어받는다
                if (key) {
                    await savePending(key, actor.orgId, {
                        date: intent.date,
                        startTime: intent.startTime,
                        endTime: null,
                        vehicleId: intent.vehicleId,
                        purpose: intent.purpose,
                        destination: intent.destination,
                    });
                }
                return { replyText: "이동시간을 계산하지 못했어요. 종료 시간을 알려주세요. 예: \"16시까지\"" };
            }
        }

        if (key) await clearPending(key); // 제안 단계로 넘어가면 슬롯 채우기 상태는 종료
        const proposal: ReservationProposal = {
            organizationId: actor.orgId,
            vehicleId: vehicle.id,
            vehicleName: vehicle.name,
            date: intent.date!,
            startTime: intent.startTime!,
            endTime,
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

/** 확인된 예약 수정 제안 실행 — 결과를 사용자용 텍스트로 반환 */
export async function executeModifyProposal(proposal: ModifyProposal, _source: string): Promise<string> {
    try {
        await modifyReservationTx({
            reservationId: proposal.reservationId,
            actorUid: proposal.actorUid,
            actorOrgId: proposal.organizationId,
            date: proposal.date,
            startTime: proposal.startTime,
            endTime: proposal.endTime,
        });
        return `✏️ ${proposal.vehicleName} 예약을 변경했습니다.\n📅 ${proposal.date} ${proposal.startTime}~${proposal.endTime}`;
    } catch (err) {
        if (err instanceof HttpsError) {
            // 코어의 한국어 에러 메시지를 그대로 전달 (예: "이미 예약되어 있습니다")
            return `❌ 예약 수정에 실패했습니다: ${err.message}`;
        }
        throw err;
    }
}
