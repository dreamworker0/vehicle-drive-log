/**
 * Google Calendar 동기화 모듈
 * 차량 예약 생성/수정/삭제 시 구글 캘린더 이벤트를 자동 동기화합니다.
 * Firebase 기본 서비스 계정(ADC)으로 인증합니다.
 */

const { google } = require("googleapis");

// ADC(Application Default Credentials)로 인증된 캘린더 클라이언트 생성
async function getCalendarClient() {
    const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    return google.calendar({ version: "v3", auth });
}

/**
 * 캘린더 이벤트 생성
 * @param {string} calendarId - 구글 캘린더 ID
 * @param {object} reservation - 예약 데이터
 * @returns {string} 생성된 이벤트 ID
 */
async function createCalendarEvent(calendarId, reservation) {
    const calendar = await getCalendarClient();
    const event = buildEvent(reservation);

    const res = await calendar.events.insert({
        calendarId,
        requestBody: event,
    });

    console.log(`캘린더 이벤트 생성: ${res.data.id} (calendar: ${calendarId})`);
    return res.data.id;
}

/**
 * 캘린더 이벤트 수정
 * @param {string} calendarId - 구글 캘린더 ID
 * @param {string} eventId - 기존 이벤트 ID
 * @param {object} reservation - 수정된 예약 데이터
 */
async function updateCalendarEvent(calendarId, eventId, reservation) {
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
 * @param {string} calendarId - 구글 캘린더 ID
 * @param {string} eventId - 삭제할 이벤트 ID
 */
async function deleteCalendarEvent(calendarId, eventId) {
    const calendar = await getCalendarClient();

    try {
        await calendar.events.delete({
            calendarId,
            eventId,
        });
        console.log(`캘린더 이벤트 삭제: ${eventId}`);
    } catch (err) {
        // 이미 삭제된 이벤트인 경우 무시 (410 Gone 또는 404 Not Found)
        if (err.code === 410 || err.code === 404) {
            console.log(`캘린더 이벤트 이미 삭제됨: ${eventId}`);
        } else {
            throw err;
        }
    }
}

/**
 * 예약 데이터 → 캘린더 이벤트 객체 변환
 */
function buildEvent(reservation) {
    const { date, startTime, endTime, vehicleName, reservedByName, purpose, destination } = reservation;

    // ISO 8601 datetime 생성 (Asia/Seoul)
    const startDateTime = `${date}T${startTime}:00`;
    const endDateTime = `${date}T${endTime}:00`;

    // 차량별 캘린더이므로 차량명 생략, 목적지 — 예약자 형식
    const summary = destination
        ? `${destination} — ${reservedByName || ""}`
        : reservedByName || "예약";

    const descriptionParts = [];
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
 * @param {string} calendarId - 구글 캘린더 ID
 * @param {string} timeMin - 조회 시작 시간 (ISO 8601)
 * @param {string} timeMax - 조회 종료 시간 (ISO 8601)
 * @returns {Array} 이벤트 목록
 */
async function listCalendarEvents(calendarId, timeMin, timeMax) {
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
        id: event.id,
        summary: event.summary || "",
        description: event.description || "",
        start: event.start,
        end: event.end,
        status: event.status, // "confirmed", "tentative", "cancelled"
        updated: event.updated,
        creator: event.creator || null,
    }));
}

/**
 * 캘린더 이벤트에서 예약 데이터를 파싱
 * 1. description에서 예약자, 용도, 목적지 추출
 * 2. 제목에서 "목적지 - 예약자" 형식 파싱 (구분자: -, –, —)
 * 3. creator.email로 사용자 식별 가능
 */
function parseEventToReservation(event, vehicleId, vehicleName, organizationId) {
    const startDt = event.start.dateTime || event.start.date;
    const endDt = event.end.dateTime || event.end.date;

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
        // 구분자: —, –, - (앞뒤 공백 포함)
        const match = summary.match(/^(.+?)\s*[—–\-]\s*(.+)$/);
        if (match) {
            if (!destination) destination = match[1].trim();
            if (!reservedByName) reservedByName = match[2].trim();
        } else if (!destination && summary) {
            // 구분자 없으면 제목 전체를 목적지로 (예약자는 creator.email에서 조회)
            destination = summary;
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

module.exports = {
    createCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    listCalendarEvents,
    parseEventToReservation,
};
