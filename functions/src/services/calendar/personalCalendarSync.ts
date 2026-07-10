import { google, calendar_v3 } from "googleapis";
import { db } from "../../core/firebase";
import { captureError } from "../../core/sentry";

// google.auth.OAuth2 인스턴스 타입(외부 패키지 직접 import 없이 파생)
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export interface GoogleOauthData {
    accessToken: string;
    refreshToken: string;
    expiryDate: number; // Token 만료 Unix Timestamp (ms)
    email?: string;
}

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

export async function getValidOAuth2Client(uid: string): Promise<OAuth2Client> {
    // OAuth 토큰은 users/{uid}/private/oauth 서브컬렉션에 보관한다 (Admin SDK 전용).
    // 과거 users 문서 필드 저장은 같은 기관 멤버가 리프레시 토큰을 읽어 계정을
    // 임퍼소네이션할 수 있었음 (2026-07-10 감사 #4).
    const oauthRef = db.collection("users").doc(uid).collection("private").doc("oauth");
    const oauthSnap = await oauthRef.get();
    const oauthData = oauthSnap.exists ? (oauthSnap.data() as GoogleOauthData | undefined) : undefined;

    if (!oauthData || !oauthData.accessToken || !oauthData.refreshToken) {
        throw new Error(`Google OAuth credentials not found for user ${uid}`);
    }

    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_OAUTH_CLIENT_ID,
        process.env.GOOGLE_OAUTH_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
        access_token: oauthData.accessToken,
        refresh_token: oauthData.refreshToken,
        expiry_date: oauthData.expiryDate,
    });

    // 5분 이내 만료이거나 이미 만료된 경우 토큰 갱신
    const now = Date.now();
    const BUFFER_TIME = 5 * 60 * 1000; // 5분

    if (oauthData.expiryDate - now <= BUFFER_TIME) {
        try {
            const { credentials } = await oauth2Client.refreshAccessToken();
            
            // 트랜잭션을 적용하여 동시성 상황에서 토큰 덮어쓰기 레이스 컨디션 방지
            let finalOauthData = oauthData;
            await db.runTransaction(async (transaction) => {
                const freshSnap = await transaction.get(oauthRef);
                const freshOauthData = freshSnap.exists ? (freshSnap.data() as GoogleOauthData | undefined) : undefined;

                // 만약 그 사이에 다른 트랜잭션이 이미 토큰을 더 최근에 갱신했다면 (만료 버퍼를 초과하게 갱신됨),
                // 그것을 덮어쓰지 않고 최신 값을 그대로 유지합니다.
                if (freshOauthData && freshOauthData.expiryDate - Date.now() > BUFFER_TIME) {
                    finalOauthData = freshOauthData;
                    return;
                }

                const updatedOauthData: GoogleOauthData = {
                    ...(freshOauthData || oauthData),
                    accessToken: credentials.access_token || (freshOauthData?.accessToken || oauthData.accessToken),
                    expiryDate: credentials.expiry_date || (Date.now() + 3600 * 1000),
                };

                if (credentials.refresh_token) {
                    updatedOauthData.refreshToken = credentials.refresh_token;
                }

                transaction.set(oauthRef, updatedOauthData, { merge: true });
                finalOauthData = updatedOauthData;
            });

            // 클라이언트에 최종 결정된 크리덴셜 적용
            oauth2Client.setCredentials({
                access_token: finalOauthData.accessToken,
                refresh_token: finalOauthData.refreshToken,
                expiry_date: finalOauthData.expiryDate,
            });
        } catch (error) {
            captureError(error, { context: "getValidOAuth2Client_refresh", uid });
            throw error;
        }
    }

    return oauth2Client;
}

// 예약 데이터 -> 캘린더 이벤트 객체 변환
function buildEvent(reservation: ReservationData): calendar_v3.Schema$Event {
    const { date, startTime, endTime, reservedByName, purpose, destination, vehicleName } = reservation;

    const startDateTime = `${date}T${startTime}:00`;
    const endDateTime = `${date}T${endTime}:00`;

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

// 개인 캘린더 이벤트 생성
export async function createPersonalCalendarEvent(oauth2Client: OAuth2Client, reservation: ReservationData): Promise<string> {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const event = buildEvent(reservation);

    const res = await calendar.events.insert({
        calendarId: "primary",
        requestBody: event,
    });

    console.log(`개인 캘린더 이벤트 생성: ${res.data.id}`);
    return res.data.id!;
}

// 개인 캘린더 이벤트 수정
export async function updatePersonalCalendarEvent(oauth2Client: OAuth2Client, eventId: string, reservation: ReservationData): Promise<void> {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const event = buildEvent(reservation);

    await calendar.events.update({
        calendarId: "primary",
        eventId,
        requestBody: event,
    });

    console.log(`개인 캘린더 이벤트 수정: ${eventId}`);
}

// 개인 캘린더 이벤트 삭제
export async function deletePersonalCalendarEvent(oauth2Client: OAuth2Client, eventId: string): Promise<void> {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    try {
        await calendar.events.delete({
            calendarId: "primary",
            eventId,
        });
        console.log(`개인 캘린더 이벤트 삭제: ${eventId}`);
    } catch (err: unknown) {
        const error = err as { code?: number };
        if (error.code === 410 || error.code === 404) {
            console.log(`개인 캘린더 이벤트 이미 삭제됨: ${eventId}`);
        } else {
            throw err;
        }
    }
}
