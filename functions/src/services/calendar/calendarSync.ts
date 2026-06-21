/**
 * Google Calendar 동기화 모듈
 * 차량 예약 생성/수정/삭제 시 구글 캘린더 이벤트를 자동 동기화합니다.
 * Firebase 기본 서비스 계정(ADC)으로 인증합니다.
 */

import { google, calendar_v3 } from "googleapis";

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
async function getCalendarClient(): Promise<calendar_v3.Calendar> {
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
 * 캘린더 이벤트에서 예약 데이터를 파싱
 */
export function parseEventToReservation(event: CalendarEvent, vehicleId: string, vehicleName: string, organizationId: string): ParsedReservation {
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
