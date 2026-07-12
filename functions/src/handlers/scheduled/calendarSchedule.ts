/**
 * calendarSchedule — Google Calendar → App 역동기화 스케줄러
 */
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { listCalendarEvents, parseEventToReservation } from "../../services/calendar/calendarSync";
import { RETRY_COOLDOWN_MS, MAX_FAIL_COUNT, isCalendarAuthError, recordCalendarFailure, resetCalendarFailure } from "../../services/calendar/calendarFailTracking";
import { sendDiscordAlert } from "../../core/discord";
import { recordHeartbeat } from "../../utils/helpers";
import { toKSTDate, getKSTDateString } from "../../utils/kstDate";
import { maskEmail } from "../../utils/mask";

const db = getFirestore();
const auth = getAuth();

/**
 * 이메일로 Firebase Auth 사용자 조회 (UID + displayName)
 */
async function findUserByEmail(email: string) {
    if (!email) return null;
    try {
        return await auth.getUserByEmail(email);
    } catch {
        return null;
    }
}

/**
 * Google Calendar -> App 역동기화 (평일 06~22시, 1시간마다)
 * 비용 최적화: 주말 및 심야(23~05시) 스킵, 실패 캘린더 자동 제외
 */
export const syncCalendarToApp = onSchedule(
    {
        schedule: "0 6-22 * * 1-5", // 평일(월~금) 06시부터 22시까지 매시 정각 (1시간 주기)
        timeZone: "Asia/Seoul",
        retryCount: 0,
        memory: "512MiB",
        timeoutSeconds: 120,
    },
    async function () {
        // 주말(토/일) 및 심야 시간(23시~05시) 동기화 스킵 (방어적 코드)
        const nowKST = toKSTDate();
        const dayOfWeek = nowKST.getDay(); // 0=일, 6=토
        const hour = nowKST.getHours();

        if (dayOfWeek === 0 || dayOfWeek === 6 || hour < 6 || hour > 22) {
            console.log(`=== Calendar sync skipped (weekend or night: ${hour}시) ===`);
            await recordHeartbeat("syncCalendarToApp");
            return;
        }

        console.log("=== Calendar -> App reverse sync start ===");

        try {
            // googleCalendarId가 있는 모든 차량 조회
            const vehiclesSnap = await db.collection("vehicles")
                .where("googleCalendarId", "!=", "")
                .get();

            if (vehiclesSnap.empty) {
                console.log("No calendar-linked vehicles, skip");
                return;
            }

            // 조회 범위: 오늘 기준 -1일 ~ +7일
            const now = new Date();
            const timeMin = new Date(now);
            timeMin.setDate(timeMin.getDate() - 1);
            timeMin.setHours(0, 0, 0, 0);
            const timeMax = new Date(now);
            timeMax.setDate(timeMax.getDate() + 7);
            timeMax.setHours(23, 59, 59, 999);

            let totalCreated = 0;
            let totalUpdated = 0;
            let totalCancelled = 0;
            let totalSkippedDup = 0;
            let totalSkippedCooldown = 0;
            let totalSkippedPermanent = 0;

            const globalProcessedEventIds = new Set<string>();

            for (let i = 0; i < vehiclesSnap.docs.length; i++) {
                const vehicleDoc = vehiclesSnap.docs[i];
                const vehicle = vehicleDoc.data();
                const vehicleId = vehicleDoc.id;
                const calendarId = vehicle.googleCalendarId as string;
                const vehicleName = (vehicle.displayName as string) || "";

                // 유효하지 않은 캘린더 ID 건너뛰기 (@ 포함 필수)
                if (!calendarId || !calendarId.includes("@")) {
                    console.log("Vehicle " + vehicleName + "(" + vehicleId + "): invalid calendar ID, skip");
                    continue;
                }

                // 연속 실패 횟수에 따른 동기화 제외 판단
                const failCount = (vehicle.calendarSyncFailCount as number) || 0;
                if (failCount >= MAX_FAIL_COUNT) {
                    // 10회 이상: 영구 제외 (수동 리셋 필요)
                    totalSkippedPermanent++;
                    continue;
                }
                if (failCount >= 3) {
                    // 3~9회: 24시간 쿨다운 후 1회 재시도
                    const lastFailAt = vehicle.calendarSyncLastFailAt;
                    const lastFailTime = lastFailAt?.toDate?.() || lastFailAt;
                    if (lastFailTime && (Date.now() - new Date(lastFailTime).getTime()) < RETRY_COOLDOWN_MS) {
                        totalSkippedCooldown++;
                        continue;
                    }
                    console.log("Vehicle " + vehicleName + "(" + vehicleId + "): 24h cooldown passed, retrying (failCount: " + failCount + ")");
                }

                try {
                    // 개별 차량 동기화 로직 호출
                    const result = await syncSingleVehicleCalendar(vehicleId, vehicle, globalProcessedEventIds);
                    
                    totalCreated += result.created;
                    totalUpdated += result.updated;
                    totalCancelled += result.cancelled;
                    totalSkippedDup += result.skippedDup;

                    // 동기화 성공 시 실패 카운터 리셋
                    if (failCount > 0) {
                        await resetCalendarFailure(vehicleId);
                    }
                } catch (vehicleErr: unknown) {
                    const errMsg = (vehicleErr as Error).message;
                    console.error("Vehicle " + vehicleName + "(" + vehicleId + ") sync failed:", errMsg);

                    // Not Found / 인증 에러 시 실패 카운터 증가
                    if (isCalendarAuthError(vehicleErr)) {
                        const newFailCount = await recordCalendarFailure(vehicleId, failCount);
                        if (newFailCount >= MAX_FAIL_COUNT) {
                            console.warn("Vehicle " + vehicleName + "(" + vehicleId + "): permanently disabled after " + newFailCount + " failures");
                        } else if (newFailCount >= 3) {
                            console.warn("Vehicle " + vehicleName + "(" + vehicleId + "): cooldown activated after " + newFailCount + " failures (retry in 24h)");
                        }
                    }
                }
            }

            console.log("=== Reverse sync done: created " + totalCreated + ", updated " + totalUpdated + ", cancelled " + totalCancelled + ", skippedDup " + totalSkippedDup + ", skippedCooldown " + totalSkippedCooldown + ", skippedPermanent " + totalSkippedPermanent + " ===");

            // [이상 감지 알림] 2시간 동안 예약 증식이 10건 이상이면 비정상 폭증으로 간주
            if (totalCreated >= 10) {
                await sendDiscordAlert({
                    title: "🚨 [긴급] 캘린더 동기화 시스템 예외 상황 감지",
                    description: `한 번의 동기화 주기(2시간) 내에 **${totalCreated}건**의 예약이 새롭게 생성되었습니다.\n무한 증식 버그이거나 일시적인 폭증일 수 있으므로 Firestore 및 이벤트 로그 점검이 필요합니다.`,
                    color: 16711680
                });
            }

            await recordHeartbeat("syncCalendarToApp");
        } catch (err: unknown) {
            console.error("Reverse sync overall failed:", (err as Error).message);
        }
    }
);

/**
 * 단일 차량 구글 캘린더 동기화 핵심 로직
 */
export async function syncSingleVehicleCalendar(
    vehicleId: string,
    vehicleData: FirebaseFirestore.DocumentData,
    globalProcessedEventIds: Set<string> = new Set<string>()
): Promise<{
    created: number;
    updated: number;
    cancelled: number;
    skippedDup: number;
}> {
    const calendarId = vehicleData.googleCalendarId as string;
    const vehicleName = (vehicleData.displayName as string) || "";
    const organizationId = vehicleData.organizationId as string;

    let created = 0;
    let updated = 0;
    let cancelled = 0;
    let skippedDup = 0;

    // 유효하지 않은 캘린더 ID 건너뛰기 (@ 포함 필수)
    if (!calendarId || !calendarId.includes("@")) {
        console.log("Vehicle " + vehicleName + "(" + vehicleId + "): invalid calendar ID, skip");
        return { created, updated, cancelled, skippedDup };
    }

    // 조회 범위: 오늘 기준 -1일 ~ +7일
    const now = new Date();
    const timeMin = new Date(now);
    timeMin.setDate(timeMin.getDate() - 1);
    timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(now);
    timeMax.setDate(timeMax.getDate() + 7);
    timeMax.setHours(23, 59, 59, 999);

    // 1. 캘린더 이벤트 조회
    const calendarEvents = await listCalendarEvents(
        calendarId,
        timeMin.toISOString(),
        timeMax.toISOString()
    );

    // 2. 해당 차량의 기존 예약 조회 (UTC/KST 시간대 오류를 피하기 위해 조회 범위를 하루씩 넉넉히 잡습니다)
    const dateMinObj = new Date(timeMin);
    dateMinObj.setDate(dateMinObj.getDate() - 2);
    const dateMin = getKSTDateString(dateMinObj);
    
    const dateMaxObj = new Date(timeMax);
    dateMaxObj.setDate(dateMaxObj.getDate() + 2);
    const dateMax = getKSTDateString(dateMaxObj);

    const existingSnap = await db.collection("reservations")
        .where("vehicleId", "==", vehicleId)
        .where("date", ">=", dateMin)
        .where("date", "<=", dateMax)
        .get();

    const existingByEventId: Record<string, Record<string, unknown>> = {};
    const existingReservations: Array<Record<string, unknown>> = [];
    existingSnap.docs.forEach(function (d) {
        const data: Record<string, unknown> = { id: d.id, ...d.data() };
        existingReservations.push(data);
        if (data.calendarEventId) {
            existingByEventId[data.calendarEventId as string] = data;
            // 이미 존재하는 예약의 calendarEventId를 전역 Set에 등록
            if (data.status !== "cancelled") {
                globalProcessedEventIds.add(data.calendarEventId as string);
            }
        }
    });

    const calendarEventIds = new Set(calendarEvents.map(function (e) { return e.id; }));

    // 3. 캘린더 이벤트 기준으로 동기화
    for (let j = 0; j < calendarEvents.length; j++) {
        const calEvent = calendarEvents[j];
        // 취소된 이벤트는 건너뜀
        if (calEvent.status === "cancelled") continue;

        let existing = existingByEventId[calEvent.id];

        if (!existing) {
            // calendarEventId로 연결되지 않은 예약 중에서, 동일 조건(날짜, 시간, 차량)의 앱 생성 예약 찾기
            const tempParsed = parseEventToReservation(calEvent, vehicleId, vehicleName, organizationId) as Record<string, unknown>;
            const matchingAppReservation = existingReservations.find(function (r) {
                return r.date === tempParsed.date &&
                       r.startTime === tempParsed.startTime &&
                       r.endTime === tempParsed.endTime &&
                       r.vehicleId === vehicleId &&
                       r.status !== "cancelled" &&
                       !r.calendarEventId; // 아직 calendarEventId가 없는 예약 (최신 생성 등)
            });

            if (matchingAppReservation) {
                // 앱에서 생성되었으나 아직 calendarEventId가 매핑되지 않은 예약 발견
                existing = matchingAppReservation;
                // Firestore에 calendarEventId 업데이트 후 중첩 방지
                await db.collection("reservations").doc(existing.id as string).update({
                    calendarEventId: calEvent.id
                });
                existing.calendarEventId = calEvent.id;
                existingByEventId[calEvent.id] = existing;
                globalProcessedEventIds.add(calEvent.id);
                console.log("[" + vehicleName + "] Linked unmapped app reservation " + existing.id + " with calendar event " + calEvent.id);
            }
        }

        if (!existing) {
            // 같은 calendarEventId가 다른 차량에서 이미 처리되었으면 건너뛰기
            if (globalProcessedEventIds.has(calEvent.id)) {
                skippedDup++;
                console.log("[" + vehicleName + "] Skip duplicate calendarEventId: " + calEvent.id + " (" + calEvent.summary + ")");
                continue;
            }

            // [결정적 버그 픽스] date 필터 밖으로 벗어났거나, 이미 존재하는 이벤트인지 최종 점검 (Double Check)
            const doubleCheckSnap = await db.collection("reservations")
                .where("calendarEventId", "==", calEvent.id)
                .limit(1)
                .get();
                
            if (!doubleCheckSnap.empty) {
                const dupDoc = doubleCheckSnap.docs[0];
                existingByEventId[calEvent.id] = { id: dupDoc.id, ...dupDoc.data() };
                globalProcessedEventIds.add(calEvent.id);
                console.log("[" + vehicleName + "] Found existing event out of date range for calendarEventId: " + calEvent.id);
                // 기존 문서가 있음 처리로 넘기기 위해 루프 강제 분기
                existing = existingByEventId[calEvent.id];
            }
        }

        // 위 더블체크 로직을 거쳐도 existing이 없으면 진짜 새로 만듦
        if (!existing) {
            // 새 이벤트 -> Firestore에 예약 생성
            const reservationData = parseEventToReservation(
                calEvent, vehicleId, vehicleName, organizationId
            ) as Record<string, unknown>;

            // creator.email로 사용자 UID 및 이름 조회
            if (reservationData.creatorEmail) {
                const userRecord = await findUserByEmail(reservationData.creatorEmail as string);
                if (userRecord) {
                    reservationData.reservedByUid = userRecord.uid;
                    reservationData.userId = userRecord.uid;
                    if (!reservationData.reservedByName) {
                        if (userRecord.displayName) {
                            reservationData.reservedByName = userRecord.displayName;
                        } else {
                            // 이메일/비밀번호 계정은 Auth displayName이 비어 있는 경우가 많아
                            // Firestore 프로필(users/{uid}.name)로 폴백
                            const profileSnap = await db.collection("users").doc(userRecord.uid).get();
                            const profileName = profileSnap.exists ? (profileSnap.data()?.name as string | undefined) : undefined;
                            if (profileName) reservationData.reservedByName = profileName;
                        }
                    }
                    console.log("[" + vehicleName + "] User matched: " + maskEmail(reservationData.creatorEmail as string) + " -> " + userRecord.uid);
                }
                // 최종 폴백: 이메일 로컬파트 — "예약자 미상"으로 남지 않게 최소 식별자 제공
                // (개인정보 보호를 위해 이메일 전체는 저장하지 않음)
                if (!reservationData.reservedByName) {
                    reservationData.reservedByName = (reservationData.creatorEmail as string).split("@")[0];
                }
            }

            // creatorEmail은 Firestore에 저장하지 않음
            delete reservationData.creatorEmail;

            reservationData.createdAt = FieldValue.serverTimestamp();
            // [원천 차단] 예약 생성 시 임의의 난수 ID 대신 구글 캘린더 이벤트 ID를 문서 ID로 고정하여 절대 중복 생성되지 않게 함
            await db.collection("reservations").doc(calEvent.id).set(reservationData);
            globalProcessedEventIds.add(calEvent.id);
            created++;
            console.log("[" + vehicleName + "] New reservation: " + calEvent.summary + " (" + calEvent.id + ")");
        } else {
            // 기존 예약이 있음 -> 내용 비교 후 업데이트
            const parsed = parseEventToReservation(
                calEvent, vehicleId, vehicleName, organizationId
            );

            const fieldsToCompare = ["date", "startTime", "endTime", "purpose", "destination"];
            const changed = fieldsToCompare.some(function (f) { return (parsed as Record<string, unknown>)[f] !== existing[f]; });

            if (changed && existing.syncSource === "calendar") {
                await db.collection("reservations").doc(existing.id as string).update({
                    date: parsed.date,
                    startTime: parsed.startTime,
                    endTime: parsed.endTime,
                    purpose: parsed.purpose,
                    destination: parsed.destination,
                    reservedByName: parsed.reservedByName,
                    syncSource: "calendar",
                });
                updated++;
                console.log("[" + vehicleName + "] Reservation updated: " + existing.id);
            }
        }
    }

    // 4. Firestore에만 있고 캘린더에 없는 (캘린더에서 삭제된) 이벤트 처리
    for (let k = 0; k < existingReservations.length; k++) {
        const reservation = existingReservations[k];
        if (
            reservation.calendarEventId &&
            reservation.syncSource === "calendar" &&
            reservation.status !== "cancelled" &&
            !calendarEventIds.has(reservation.calendarEventId as string)
        ) {
            await db.collection("reservations").doc(reservation.id as string).update({
                status: "cancelled",
                syncSource: "calendar",
            });
            cancelled++;
            console.log("[" + vehicleName + "] Reservation cancelled (calendar deleted): " + reservation.id);
        }
    }

    return { created, updated, cancelled, skippedDup };
}

/**
 * 특정 단일 차량에 대해서만 구글 캘린더 이벤트를 즉시 동기화합니다. (웹훅 등에서 호출용)
 * 기존 스케줄러의 동기화 로직과 유사한 기능을 개별 차량 단위로 좁혀서 실행할 수 있습니다.
 */
export async function syncVehicleCalendar(vehicleId: string, vehicleInfo: Record<string, unknown>) {
    const calendarId = vehicleInfo.googleCalendarId as string;
    const vehicleName = (vehicleInfo.displayName as string) || "";
    
    if (!calendarId || !calendarId.includes("@")) {
        console.log(`[SyncVehicle] Vehicle ${vehicleName}(${vehicleId}) invalid calendar ID, skip`);
        return;
    }
    
    console.log(`[SyncVehicle] Start single vehicle sync for ${vehicleName} (${vehicleId})`);
    
    try {
        await syncSingleVehicleCalendar(vehicleId, vehicleInfo);
    } catch (err: unknown) {
        console.error(`[SyncVehicle] Single sync failed for ${vehicleName}:`, (err as Error).message);
    }
}
