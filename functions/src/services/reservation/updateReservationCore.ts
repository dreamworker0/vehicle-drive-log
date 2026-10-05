/**
 * updateReservationCore — 화면의 예약 수정(단건 수정·반복 그룹에서 떼어내기)의 권위 코어 로직
 *
 * 예약 **생성**은 2026-07-10 감사 #5 이후 콜러블 전용이었지만, **수정**은 화면이 Firestore에
 * 직접 썼다. Rules의 소유자 분기는 기관·명의 불변과 pending→reserved 자가 승인만 막았기 때문에
 * 생성 때 서버가 강제하던 정책이 수정 한 번에 풀렸다 (2026-10-03 감사 발견 1):
 *   - 승인된 예약의 날짜·시간·차량을 바꿔도 status가 reserved로 남았다 (승인제 우회 — 정상 화면에서도)
 *   - 차량별 사용 가능 직원 제한(allowedUserIds)·정비/폐차 차단을 건너뛰었다
 *   - 차량만 바꾸면 수정 트리거의 겹침 검사도 돌지 않았다 (이중 예약)
 *
 * 그래서 일정·차량·명의를 바꾸는 수정은 생성과 **같은 검증**을 여기서 다시 한다. 목적지·목적·
 * 동승자처럼 정책과 무관한 정보만 바뀌는 수정은 검증 없이 반영한다 — 완료된 예약의 기록 정정도
 * 이 경로를 쓰므로, 상태로 막으면 지금 되는 일이 안 된다.
 *
 * 메신저 어시스턴트의 날짜·시간 수정은 modifyReservationCore가 따로 맡는다(본인 예약만·차량 변경 없음).
 */
import { randomUUID } from "crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { DocumentData, DocumentReference } from "firebase-admin/firestore";
import { isVehicleBlockedOn, isVehicleRetired, seoulTodayStr } from "../../utils/vehicleStatus";

const db = getFirestore();

export interface UpdateReservationInput {
    reservationId: string;
    /** 수정을 요청하는 실제 사용자 UID */
    actorUid: string;
    /** 호출자의 소속 기관 ID — 예약 organizationId와 불일치 시 거부 */
    actorOrgId?: string;
    /** 호출자의 역할 (Custom Claims) — 남의 예약 수정·명의 변경·재승인 면제 판정 */
    actorRole?: string;

    // ── 일정·차량·명의 (바뀌면 생성과 같은 검증) ──
    vehicleId?: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    /** 명의 변경 — 기관 관리자만 */
    reservedByUid?: string;

    // ── 정보 (검증 없이 반영) ──
    vehicleName?: string;
    reservedByName?: string;
    purpose?: string;
    destination?: string;
    routeDistance?: number | null;
    routeDuration?: number | null;
    routeTollFee?: number | null;
    passengerUids?: string[];
    passengerNames?: string[];
    passengerCount?: number;

    // ── 반복 그룹에서 떼어내기 (반복 → 단건 / 반복 → 다일 전환) ──
    /** true면 recurringGroupId를 지운다 */
    detachRecurring?: boolean;
    /** 떼어내면서 붙일 새 다일 그룹 — detachRecurring과 함께일 때만 받는다 */
    groupId?: string;
}

export interface UpdateReservationResult {
    /** 저장 후 상태 — 승인제 기관에서 일정이 바뀌면 pending으로 돌아간다 */
    status: string;
    /** 이번 수정으로 승인 대기로 돌아갔는가 (화면 안내용) */
    requiresReapproval: boolean;
}

/** 동승자 배열 길이 상한 — createReservationCore·클라이언트와 같은 값 */
const MAX_PASSENGERS = 50;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** 일정을 옮길 수 없는 상태 — 이미 끝난(무효가 된) 예약이다 */
const CLOSED_STATUSES = new Set(["cancelled", "rejected"]);

/** 겹침 판정에 쓰는 실효 구간 — 완료된 예약은 실제 운행 시각으로 접는다 (생성 코어와 같은 규칙) */
function effectiveRange(r: DocumentData): { start: string; end: string } {
    const completed = r.status === "completed";
    return {
        start: (completed && r.actualStartTime) ? r.actualStartTime : r.startTime,
        end: (completed && r.actualEndTime) ? r.actualEndTime : r.endTime,
    };
}

function isStringOrUndefined(v: unknown): boolean {
    return v === undefined || typeof v === "string";
}

export async function updateReservationTx(
    input: UpdateReservationInput
): Promise<UpdateReservationResult> {
    const { reservationId, actorUid, actorOrgId, actorRole, detachRecurring, groupId } = input;
    const isAdmin = actorRole === "admin";

    if (!reservationId || !actorUid) {
        throw new HttpsError("invalid-argument", "reservationId는 필수입니다.");
    }
    for (const key of ["vehicleId", "date", "startTime", "endTime", "reservedByUid", "vehicleName",
        "reservedByName", "purpose", "destination", "groupId"] as const) {
        if (!isStringOrUndefined(input[key])) {
            throw new HttpsError("invalid-argument", `${key} 형식이 올바르지 않습니다.`);
        }
    }
    if (groupId && !detachRecurring) {
        throw new HttpsError("invalid-argument", "groupId는 반복 그룹에서 떼어낼 때만 지정할 수 있습니다.");
    }
    if ((input.passengerUids?.length || 0) > MAX_PASSENGERS || (input.passengerNames?.length || 0) > MAX_PASSENGERS) {
        throw new HttpsError("invalid-argument", `동승자는 최대 ${MAX_PASSENGERS}명까지 지정할 수 있습니다.`);
    }
    if (input.passengerCount !== undefined && (!Number.isInteger(input.passengerCount) || input.passengerCount < 0)) {
        throw new HttpsError("invalid-argument", "동승 인원은 0 이상의 정수여야 합니다.");
    }

    try {
        return await db.runTransaction(async (transaction) => {
            const ref = db.collection("reservations").doc(reservationId);
            const snap = await transaction.get(ref);
            if (!snap.exists) {
                throw new HttpsError("not-found", "예약을 찾을 수 없습니다.");
            }
            const r = snap.data()!;
            const orgId = r.organizationId as string;

            // 조직 격리
            if (!actorOrgId || orgId !== actorOrgId) {
                throw new HttpsError("permission-denied", "자기 기관의 예약만 수정할 수 있습니다.");
            }
            // 본인 예약 또는 기관 관리자
            if (r.reservedByUid !== actorUid && !isAdmin) {
                throw new HttpsError("permission-denied", "본인이 예약한 건만 수정할 수 있습니다.");
            }

            const next = {
                vehicleId: input.vehicleId ?? (r.vehicleId as string),
                date: input.date ?? (r.date as string),
                startTime: input.startTime ?? (r.startTime as string),
                endTime: input.endTime ?? (r.endTime as string),
                ownerUid: input.reservedByUid || (r.reservedByUid as string),
            };
            const vehicleChanged = next.vehicleId !== r.vehicleId;
            const ownerChanged = next.ownerUid !== r.reservedByUid;
            const scheduleChanged = vehicleChanged
                || next.date !== r.date || next.startTime !== r.startTime || next.endTime !== r.endTime;

            // 명의 변경은 기관 관리자만 (생성 코어의 대리 생성과 같은 기준)
            if (ownerChanged && !isAdmin) {
                throw new HttpsError("permission-denied", "다른 직원 명의로 바꾸는 것은 기관 관리자만 할 수 있습니다.");
            }

            let status = r.status as string;
            let requiresReapproval = false;
            let vehicleRef: DocumentReference | null = null;

            if (scheduleChanged || ownerChanged) {
                if (CLOSED_STATUSES.has(status)) {
                    throw new HttpsError("failed-precondition", "취소·반려된 예약은 일정을 바꿀 수 없습니다.");
                }
                if (!next.vehicleId || !DATE_RE.test(next.date) || !TIME_RE.test(next.startTime) || !TIME_RE.test(next.endTime)) {
                    throw new HttpsError("invalid-argument", "차량·날짜·시간 형식이 올바르지 않습니다.");
                }
                if (next.startTime >= next.endTime) {
                    throw new HttpsError("invalid-argument", "시작 시간은 종료 시간보다 빨라야 합니다.");
                }

                // ── 모든 읽기 (Firestore Transaction 제약: 읽기 후 쓰기) ──
                vehicleRef = db.collection("vehicles").doc(next.vehicleId);
                const vehicleSnap = await transaction.get(vehicleRef);
                if (!vehicleSnap.exists || vehicleSnap.data()?.organizationId !== orgId) {
                    throw new HttpsError("permission-denied", "자기 기관의 차량만 예약할 수 있습니다.");
                }

                if (ownerChanged) {
                    const ownerSnap = await transaction.get(db.collection("users").doc(next.ownerUid));
                    if (!ownerSnap.exists || ownerSnap.data()?.organizationId !== orgId) {
                        throw new HttpsError("permission-denied", "같은 기관 구성원 명의로만 예약할 수 있습니다.");
                    }
                }

                // 퇴역·정비 차단은 **차량을 바꿀 때만** 본다. 이미 잡힌 예약의 시간만 옮기는데
                // 그 사이 차량이 정비에 들어갔다고 수정 자체를 막으면, 정비 기간 밖으로 옮기는
                // 길까지 막힌다.
                if (vehicleChanged) {
                    if (isVehicleRetired(vehicleSnap.data()?.retired)) {
                        throw new HttpsError("failed-precondition", "폐차·매각된 차량은 예약할 수 없습니다.");
                    }
                    if (isVehicleBlockedOn(vehicleSnap.data()?.maintenance, seoulTodayStr())) {
                        throw new HttpsError("failed-precondition", "정비 중인 차량은 예약할 수 없습니다.");
                    }
                }

                // 차량별 사용 가능 직원 제한 — 판정 기준은 명의자(실제 운행자)
                if (vehicleChanged || ownerChanged) {
                    const allowedUserIds = vehicleSnap.data()?.allowedUserIds;
                    if (Array.isArray(allowedUserIds) && allowedUserIds.length > 0 && !allowedUserIds.includes(next.ownerUid)) {
                        throw new HttpsError("permission-denied", "이 차량은 지정된 직원만 예약할 수 있습니다.");
                    }
                }

                const orgSnap = await transaction.get(db.collection("organizations").doc(orgId));
                const requireReservationApproval = orgSnap.exists ? (orgSnap.data()?.requireReservationApproval === true) : false;

                // 같은 차량 겹침 (자기 자신 제외)
                const vehicleDayRes = await transaction.get(
                    db.collection("reservations")
                        .where("organizationId", "==", orgId)
                        .where("vehicleId", "==", next.vehicleId)
                        .where("date", "==", next.date)
                );
                const overlapping = vehicleDayRes.docs.find((doc) => {
                    if (doc.id === reservationId) return false;
                    const other = doc.data();
                    if (other.status === "cancelled") return false;
                    const { start, end } = effectiveRange(other);
                    return next.startTime < end && next.endTime > start;
                });
                if (overlapping) {
                    const { start, end } = effectiveRange(overlapping.data());
                    throw new HttpsError("already-exists", `해당 차량은 ${start} ~ ${end}에 이미 예약되어 있습니다.`);
                }

                // 사람 기준 겹침 — 한 사람은 같은 시간에 차량 한 대만 (자기 자신 제외)
                const ownerDayRes = await transaction.get(
                    db.collection("reservations")
                        .where("organizationId", "==", orgId)
                        .where("reservedByUid", "==", next.ownerUid)
                        .where("date", "==", next.date)
                );
                const ownerOverlapping = ownerDayRes.docs.find((doc) => {
                    if (doc.id === reservationId) return false;
                    const other = doc.data();
                    if (other.status === "cancelled") return false;
                    const { start, end } = effectiveRange(other);
                    return next.startTime < end && next.endTime > start;
                });
                if (ownerOverlapping) {
                    const other = ownerOverlapping.data();
                    const { start, end } = effectiveRange(other);
                    throw new HttpsError(
                        "already-exists",
                        `${other.reservedByName || "예약자"}님은 ${start} ~ ${end}에 ${other.vehicleName || "다른 차량"} 예약이 있습니다. ` +
                        "한 사람은 같은 시간에 한 대만 예약할 수 있습니다."
                    );
                }

                // 승인제 기관에서 직원이 **승인받은** 예약의 일정·차량을 바꾸면 다시 승인을 받는다.
                // 관리자는 승인권자라 면제(생성 코어의 바로 운행 판정과 같은 기준). 운행 중·완료된
                // 예약은 이미 쓴 차량의 기록 정정이라 되돌리지 않는다.
                if (requireReservationApproval && !isAdmin && scheduleChanged && status === "reserved") {
                    status = "pending";
                    requiresReapproval = true;
                }
            }

            // ── 쓰기 ──
            const update: Record<string, unknown> = {};
            if (scheduleChanged || ownerChanged) {
                update.vehicleId = next.vehicleId;
                update.date = next.date;
                update.startTime = next.startTime;
                update.endTime = next.endTime;
                update.reservedByUid = next.ownerUid;
            }
            if (input.vehicleName !== undefined) update.vehicleName = input.vehicleName;
            if (input.reservedByName !== undefined) update.reservedByName = input.reservedByName;
            if (input.purpose !== undefined) update.purpose = input.purpose;
            if (input.destination !== undefined) update.destination = input.destination;
            if (input.routeDistance !== undefined) update.routeDistance = input.routeDistance || null;
            if (input.routeDuration !== undefined) update.routeDuration = input.routeDuration || null;
            if (input.routeTollFee !== undefined) update.routeTollFee = input.routeTollFee || null;
            if (input.passengerUids !== undefined) update.passengerUids = input.passengerUids;
            if (input.passengerNames !== undefined) update.passengerNames = input.passengerNames;
            if (input.passengerCount !== undefined) update.passengerCount = input.passengerCount;
            if (detachRecurring) {
                update.recurringGroupId = FieldValue.delete();
                if (groupId) update.groupId = groupId;
            }
            if (requiresReapproval) update.status = status;

            if (vehicleRef) {
                transaction.update(vehicleRef, { _lastReservationLock: FieldValue.serverTimestamp() });
            }
            if (Object.keys(update).length > 0) {
                // 접속기록의 '계정' — 새 lastEditId가 있어야 감사 트리거가 이 쓰기의 행위자로 인정한다
                update.lastEditedByUid = actorUid;
                update.lastEditId = randomUUID();
                transaction.update(ref, update);
            }

            return { status, requiresReapproval };
        });
    } catch (err: unknown) {
        if (err instanceof HttpsError) throw err;
        console.error("updateReservationTx 실패:", (err as Error).message);
        throw new HttpsError("internal", "예약 수정에 실패했습니다.");
    }
}
