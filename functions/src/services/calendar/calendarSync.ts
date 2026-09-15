/**
 * Google Calendar 동기화 모듈
 * 차량 예약 생성/수정/삭제 시 구글 캘린더 이벤트를 자동 동기화합니다.
 * Firebase 기본 서비스 계정(ADC)으로 인증합니다.
 */

// googleapis는 require에만 ~0.9초가 드는 초대형 패키지다. index.ts가 모든 함수를 한 번들로
// 묶으므로 최상단에서 import하면 캘린더와 무관한 함수까지 콜드스타트마다 그 비용을 낸다.
// 타입은 컴파일 시 지워지는 `import type`으로, 런타임 객체는 실제 호출 시점에 동적 import로 가져온다.
// (2026-08-28 Cloud Run 비용 점검)
import type { calendar_v3 } from "googleapis";

interface ReservationData {
    date: string;
    startTime: string;
    endTime: string;
    vehicleName?: string;
    reservedByName?: string;
    purpose?: string;
    destination?: string;
    [key: string]: unknown;
}

interface CalendarEvent {
    id: string;
    summary: string;
    description: string;
    start: calendar_v3.Schema$EventDateTime;
    end: calendar_v3.Schema$EventDateTime;
    status: string;
    updated: string;
    creator: { email?: string } | null;
}

// ADC(Application Default Credentials)로 인증된 캘린더 클라이언트 생성
// googleapis 로드는 Node 모듈 캐시가 받아 주므로 두 번째 호출부터는 비용이 없다.
async function getCalendarClient(): Promise<calendar_v3.Calendar> {
    const { google } = await import("googleapis");
    const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    return google.calendar({ version: "v3", auth });
}

/**
 * 캘린더 이벤트 생성
 */
export async function createCalendarEvent(calendarId: string, reservation: ReservationData): Promise<string> {
    const calendar = await getCalendarClient();
    const event = buildEvent(reservation);

    const res = await calendar.events.insert({
        calendarId,
        requestBody: event,
    });

    console.log(`캘린더 이벤트 생성: ${res.data.id} (calendar: ${calendarId})`);
    return res.data.id!;
}

/**
 * 캘린더 이벤트 수정
 */
export async function updateCalendarEvent(calendarId: string, eventId: string, reservation: ReservationData): Promise<void> {
    const calendar = await getCalendarClient();
    const event = buildEvent(reservation);

    await calendar.events.update({
        calendarId,
        eventId,
        requestBody: event,
    });

    console.log(`캘린더 이벤트 수정: ${eventId}`);
}

/**
 * 캘린더 이벤트 삭제
 */
export async function deleteCalendarEvent(calendarId: string, eventId: string): Promise<void> {
    const calendar = await getCalendarClient();

    try {
        await calendar.events.delete({
            calendarId,
            eventId,
        });
        console.log(`캘린더 이벤트 삭제: ${eventId}`);
    } catch (err: unknown) {
        const error = err as { code?: number };
        // 이미 삭제된 이벤트인 경우 무시 (410 Gone 또는 404 Not Found)
        if (error.code === 410 || error.code === 404) {
            console.log(`캘린더 이벤트 이미 삭제됨: ${eventId}`);
        } else {
            throw err;
        }
    }
}

/**
 * 예약 데이터 → 캘린더 이벤트 객체 변환
 */
function buildEvent(reservation: ReservationData): calendar_v3.Schema$Event {
    const { date, startTime, endTime, reservedByName, purpose, destination, vehicleName } = reservation;

    // ISO 8601 datetime 생성 (Asia/Seoul)
    const startDateTime = `${date}T${startTime}:00`;
    const endDateTime = `${date}T${endTime}:00`;

    // 캘린더 보기 편의를 위해 [차량명] 추가
    const summaryStr = destination
        ? `${destination} — ${reservedByName || ""}`
        : reservedByName || "예약";
        
    const summary = vehicleName ? `[${vehicleName}] ${summaryStr}` : summaryStr;

    const descriptionParts: string[] = [];
    if (vehicleName) descriptionParts.push(`차량: ${vehicleName}`);
    if (reservedByName) descriptionParts.push(`예약자: ${reservedByName}`);
    if (purpose) descriptionParts.push(`용도: ${purpose}`);
    if (destination) descriptionParts.push(`목적지: ${destination}`);
    descriptionParts.push(`시간: ${startTime} ~ ${endTime}`);

    return {
        summary,
        description: descriptionParts.join("\n"),
        start: {
            dateTime: startDateTime,
            timeZone: "Asia/Seoul",
        },
        end: {
            dateTime: endDateTime,
            timeZone: "Asia/Seoul",
        },
    };
}

/**
 * 캘린더 이벤트 목록 조회 (역동기화용)
 */
export async function listCalendarEvents(calendarId: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
    const calendar = await getCalendarClient();

    const res = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
    });

    return (res.data.items || []).map((event) => ({
        id: event.id!,
        summary: event.summary || "",
        description: event.description || "",
        start: event.start!,
        end: event.end!,
        status: event.status || "",
        updated: event.updated || "",
        creator: event.creator || null,
    }));
}

interface ParsedReservation {
    vehicleId: string;
    vehicleName: string;
    organizationId: string;
    reservedByName: string;
    reservedByUid: string;
    creatorEmail: string;
    date: string;
    startTime: string;
    endTime: string;
    purpose: string;
    destination: string;
    status: string;
    calendarEventId: string;
    syncSource: string;
    userId?: string;
    createdAt?: Date;
    [key: string]: unknown;
}

/**
 * 목적지 판정에서 걸러 낼 "그 차량 자신의 이름들".
 *
 * 차량 문서에서 뽑는다 — 표시 이름·본래 이름·차량번호. 스케줄러가 이미 문서를 손에 쥐고
 * 있으므로 추가 읽기가 없다.
 */
export interface VehicleNameAliases {
    displayName?: unknown;
    name?: unknown;
    plateNumber?: unknown;
}

/** 비교용 정규화 — 공백을 모두 지우고 소문자로. "스타렉스 1호"와 "스타렉스1호"를 같게 본다. */
function normalizeForNameMatch(value: string): string {
    return value.replace(/\s+/g, "").toLowerCase();
}

/**
 * 제목에서 뽑은 목적지가 사실은 **그 차량의 이름**인가.
 *
 * 사람이 구글 캘린더에서 이벤트를 만들 때 제목에 차량 이름만 적는 일이 잦다("스파크", "레이").
 * 그러면 아래 자유형식 파싱이 그것을 목적지로 집어넣고, 그 예약으로 연 운행일지의 목적지 칸이
 * 차량명으로 미리 채워진다. 운전자가 고치지 않으면 **공식 기록(PDF·Excel)에 차량명이 목적지로
 * 남는다.** 2026-09-15 이용 기관이 신고한 증상이다.
 *
 * **완전 일치만 본다.** "스파크 정비소"는 진짜 목적지이고, 부분 일치로 거르면 그것까지 죽는다.
 * 비교할 이름이 하나도 없으면 판정하지 않는다(현행 동작 유지).
 */
function isVehicleOwnName(destination: string, aliases?: VehicleNameAliases): boolean {
    const target = normalizeForNameMatch(destination);
    if (!target) return false;

    return [aliases?.displayName, aliases?.name, aliases?.plateNumber]
        .filter((v): v is string => typeof v === "string" && v.trim() !== "")
        .some(alias => normalizeForNameMatch(alias) === target);
}

/**
 * 캘린더 이벤트에서 예약 데이터를 파싱
 */
export function parseEventToReservation(
    event: CalendarEvent,
    vehicleId: string,
    vehicleName: string,
    organizationId: string,
    /** 목적지 자리에 차량 이름이 들어오는 것을 거르는 데 쓴다. 없으면 판정하지 않는다. */
    vehicleAliases?: VehicleNameAliases,
): ParsedReservation {
    const startDt = (event.start as { dateTime?: string; date?: string }).dateTime || (event.start as { date?: string }).date || "";
    const endDt = (event.end as { dateTime?: string; date?: string }).dateTime || (event.end as { date?: string }).date || "";

    // dateTime에서 날짜와 시간 추출
    const date = startDt.slice(0, 10); // YYYY-MM-DD
    const startTime = startDt.length > 10 ? startDt.slice(11, 16) : "09:00"; // HH:mm
    const endTime = endDt.length > 10 ? endDt.slice(11, 16) : "18:00";

    // description에서 정보 추출
    const desc = event.description || "";
    const lines = desc.split("\n");
    let reservedByName = "";
    let purpose = "";
    let destination = "";

    for (const line of lines) {
        if (line.startsWith("예약자:")) reservedByName = line.replace("예약자:", "").trim();
        if (line.startsWith("용도:")) purpose = line.replace("용도:", "").trim();
        if (line.startsWith("목적지:")) destination = line.replace("목적지:", "").trim();
    }

    // 설명란에서 온 목적지인지 기억해 둔다 — 아래 차량명 판정은 **제목에서 뽑은 값만** 본다.
    const destinationFromDescription = destination !== "";

    // 제목에서 "목적지 - 예약자" 형식 파싱 (description에 정보가 없을 때)
    const summary = event.summary || "";
    if (!reservedByName || !destination) {
        // 제목 앞에 붙은 [차량명] 제거 후 파싱
        const cleanedSummary = summary.replace(/^\[.*?\]\s*/, '');
        // 구분자: —, –, - (앞뒤 공백 포함)
        const match = cleanedSummary.match(/^(.+?)\s*[—–-]\s*(.+)$/);
        if (match) {
            if (!destination) destination = match[1].trim();
            if (!reservedByName) reservedByName = match[2].trim();
        } else if (!destination && cleanedSummary) {
            destination = cleanedSummary;
        }
    }

    // **제목에서 뽑은** 목적지가 그 차량 자신의 이름이면 버린다.
    //
    // 설명란의 `목적지:` 줄에서 온 값은 사람이 그 칸에 일부러 적은 것이므로 건드리지 않는다.
    // 같은 글자라도 어디에 적었느냐가 의도를 가른다 — 제목은 "무슨 차 쓴다"는 메모일 때가
    // 많지만, 목적지 칸에 차량명을 적는 사람은 없다.
    if (!destinationFromDescription && destination && isVehicleOwnName(destination, vehicleAliases)) {
        // **제목 본문은 로그에 싣지 않는다.** 자유 입력이라 개인정보가 섞인다.
        console.log(`[parseEventToReservation] 제목이 차량 이름과 같아 목적지로 쓰지 않음: veh=${vehicleId}`);
        destination = "";
    }

    // creator 이메일 추출 (사용자 UID 조회용)
    const creatorEmail = (event.creator && event.creator.email) || "";

    return {
        vehicleId,
        vehicleName,
        organizationId,
        reservedByName: reservedByName || "",
        reservedByUid: "", // calendarSchedule에서 이메일로 조회 후 설정
        creatorEmail, // 사용자 조회용 (Firestore에는 저장하지 않음)
        date,
        startTime,
        endTime,
        purpose,
        destination,
        status: "reserved",
        calendarEventId: event.id,
        syncSource: "calendar",
    };
}
