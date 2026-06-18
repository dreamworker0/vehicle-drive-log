---
name: add-calendar-integration
description: 차량운행일지와 Google Calendar API 간의 양방향/단방향 동기화, Service Account 및 사용자별 OAuth2 인증 패턴 가이드.
---

# 구글 캘린더 연동 패턴 (Google Calendar Integration)

차량운행일지는 차량별/조직별 공용 구글 캘린더 연동 외에도, **개별 사용자의 개인 구글 캘린더와 예약을 연동하는 OAuth2 기반 양방향 동기화** 기능을 제공합니다. 캘린더 연동 로직 수정이나 추가 시 아래 구조를 따릅니다.

---

## 1. 인증 로직

캘린더 연동은 대상과 시나리오에 따라 **두 가지 인증 방식**을 사용합니다.

### 1.1 Service Account (공용 차량/기관 캘린더용)
*   **로직**: `googleapis`의 `google.auth.JWT` 객체를 생성하여 액세스 권한을 획득합니다. `GOOGLE_CALENDAR_SERVICE_ACCOUNT` 환경변수(JSON)를 사용합니다.
```typescript
import { google } from 'googleapis';

const credentials = JSON.parse(process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT || '{}');
const auth = new google.auth.JWT(
    credentials.client_email,
    undefined,
    credentials.private_key,
    ['https://www.googleapis.com/auth/calendar.events']
);
const calendar = google.calendar({ version: 'v3', auth });
```

### 1.2 OAuth2 사용자 인증 (개인 캘린더 동기화용)
*   **로직**: `googleapis`의 `google.auth.OAuth2` 객체를 사용합니다. 사용자별 동의화면을 거쳐 획득한 `refresh_token`을 활용해 통신합니다.
*   **구현 파일**: `oauthCallback.ts` 등 리디렉션 처리 핸들러 및 토큰 관리 헬퍼.
```typescript
import { google } from 'googleapis';

export function getOAuth2Client() {
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI // 예: http://localhost:5001/{project}/asia-northeast3/oauthCallback
    );
}
```

---

## 2. 사용자별 토큰 관리 및 자동 갱신 패턴

사용자의 OAuth2 `refresh_token`은 보안이 확보된 안전한 영역에 저장되어야 하며, 만료 시 자동으로 `access_token`이 갱신되어야 합니다.

### 2.1 토큰 조회 및 자동 주입 헬퍼 예제
```typescript
import { getOAuth2Client } from "./oauth";
import { db } from "../core/firestore"; // Firestore 인스턴스

export async function getAuthenticatedClient(uid: string) {
    const oauth2Client = getOAuth2Client();
    
    // 1. Firestore의 보안 서브콜렉션에서 refresh_token 조회
    const tokenDoc = await db.doc(`users/${uid}/secure/oauth`).get();
    if (!tokenDoc.exists) {
        throw new Error("구글 캘린더가 연동되어 있지 않습니다.");
    }
    
    const { refresh_token } = tokenDoc.data()!;
    
    // 2. OAuth 클라이언트에 자격증명 설정
    oauth2Client.setCredentials({ refresh_token });
    
    // (선택) access_token 자동 갱신 리스너 등록
    oauth2Client.on('tokens', async (tokens) => {
        if (tokens.refresh_token) {
            // 새로 갱신된 refresh_token이 있다면 보안 저장소 갱신
            await db.doc(`users/${uid}/secure/oauth`).update({
                refresh_token: tokens.refresh_token,
                updatedAt: new Date()
            });
        }
    });

    return oauth2Client;
}
```

---

## 3. 동기화 방향성

### 3.1 앱 ➡️ 구글 캘린더 (Push)
*   사용자가 예약을 생성/수정/삭제 시 트리거(`onReservationCreated` 등)를 통해 동기화합니다.
*   반드시 구글 캘린더에서 발급받은 `calendarEventId`를 예약 문서(`reservations/{resId}`)에 보관하여 연관 관계를 맺어야 합니다.

### 3.2 구글 캘린더 ➔ 앱 (Webhook / Push Notification)
*   Google Calendar API의 `watch` 기능을 등록하여 구글 측에서 이벤트 변경 발생 시 Webhook을 수신합니다.
*   **주의 (무한 루프 방지)**: 캘린더의 이벤트를 수신하여 앱의 Firestore 예약을 업데이트할 때, 다시 Firestore 트리거가 구글 API를 재호출하지 않도록 변경 사유 필드나 `syncSource: 'google-calendar'` 플래그를 Firestore 문서 변경 옵션에 포함해야 합니다.

---

## 4. 에러 처리 및 상태 관리 (재인증 유도)

구글 API 호출 중 **401 Unauthorized** 또는 **403 Forbidden** 에러가 발생한 경우, 사용자의 연동 권한이 취소되었거나 토큰이 무효화되었음을 의미합니다.

*   **에러 감지 시 동작**:
    1.  서버사이드에서 즉시 `users/{uid}` 문서의 `calendarConnected` 필드를 `false`로 변경합니다.
    2.  `users/{uid}/secure/oauth`에 보관된 무효화된 토큰 정보를 삭제 처리합니다.
    3.  사용자가 다음 번 앱 접속 시 "구글 캘린더 연동이 끊어졌습니다. 다시 연동을 진행해 주세요."라는 토스트 메시지와 함께 OAuth 연동 버튼을 활성화하는 UI 흐름을 설계해야 합니다.
