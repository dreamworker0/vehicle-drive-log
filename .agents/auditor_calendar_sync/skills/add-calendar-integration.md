# 구글 캘린더 연동 패턴 (Google Calendar Integration) - Local Copy

차량운행일지는 차량별 구글 캘린더와 예약을 동기화하는 강력한 기능을 제공합니다. 캘린더 연동 로직 수정이나 추가 시 아래 구조를 따릅니다.

## 1. 인증 로직 (Service Account)
Google API는 Service Account(JWT) 기반 인증을 거쳐 호출됩니다.
- **구현 파일**: 주로 `calendarSync.ts`, `calendarSchedule.ts`에서 다룸.
- **로직**: `googleapis`의 `google.auth.JWT` 객체를 생성하여 액세스 권한을 획득. `GOOGLE_CALENDAR_SERVICE_ACCOUNT` 환경변수(JSON 파싱) 사용.

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

## 2. 동기화 방향성

### 2.1 앱 ➡️ 구글 캘린더 (Push)
- 사용자가 차량을 예약하거나 취소할 때(`createReservationSafe`, `cancelReservation`), Firestore 트리거 또는 함수 내부에서 캘린더로 직접 이벤트를 Insert/Update/Delete합니다.
- `calendarEventId`를 반환받아 예약 문서(reservation)에 저장해야 추후 동기화 관리가 가능합니다.

### 2.2 구글 캘린더 ➡️ 앱 (Pull / Webhook)
- **Polling 방식**: `calendarSchedule.ts` (주기적으로 구글 캘린더의 변동 사항 스캔)
- **Webhook 방식**: `calendarWebhook.ts` (구글 측에서 이벤트 푸시)
- ⚠️ 중요: 외부에서 삽입/수정된 데이터를 Firestore에 쓸 때, 무한 루프(Firestore Trigger 동작)를 막기 위해 데이터 내부에 `syncSource: 'calendar'` 플래그를 두어야 합니다.

## 3. 에러 처리 및 상태 관리 (Sync Status)
캘린더 접근 권한을 상실하거나 구글 캘린더 ID가 잘못된 경우 UI에 상태를 피드백해야 합니다.
- **에러 검출**: API 호출이 실패할 경우 403, 404 에러 캐치.
- **상태 업데이트**: 차량 문서(`vehicles/{vehicleId}`)의 `calendarSyncFailCount` 값을 증가시킵니다. 0이면 '정상', 1 이상이면 '에러'로 프론트엔드에서 간주합니다.
- **연동 테스트**: 관리자 페이지에서 `testCalendarAccess` 함수를 호출해 즉시 접근성을 검증하고, 실패 시 `calendarSyncFailCount`를 업데이트합니다.
