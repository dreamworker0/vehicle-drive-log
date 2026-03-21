# API 의존성 리스크 대응 매뉴얼

## 사용 중인 외부 API

| API | 용도 | 대안 |
|-----|------|------|
| TMap API | 지오코딩, 경로 탐색, 거리 계산 | Kakao Map API, Naver Map API |
| 공공데이터 포털 (한국천문연구원) | 공휴일 정보 | Firestore 수동 입력, 하드코딩 |
| 알리고 API (카카오 알림톡) | 기관 승인·리마인드 알림톡 발송 | 직접 카카오 비즈메시지 연동, 이메일(EmailJS) 대체 |

---

## 1. TMap API 장애 대응

### 현재 방어 체계
- **프록시 패턴**: 프로덕션에서는 Cloud Function(`tmapProxy`)를 통해 API 키 노출 방지
- **3회 실패 쿨다운**: 연속 실패 시 5분간 API 호출 중단 → 불필요한 요청 방지
- **POI 검색 폴백**: 지오코딩 실패 시 POI 검색으로 재시도

### 장애 시 조치
1. TMap 개발자센터(https://openapi.sk.com)에서 API 상태 확인
2. API 키 만료 여부 확인 → Firebase Console → Functions Config에서 갱신
3. 대안: `.env`에서 `VITE_TMAP_API_KEY`를 Kakao/Naver 키로 교체 + `tmap.js`를 해당 API 형식으로 수정

### 사용자 영향
- 경로 거리 자동 계산 불가 → **수동 입력은 항상 가능** (startKm/endKm 직접 입력)
- TMap 딥링크(네비 연결)는 앱 자체 기능이므로 API와 독립적

---

## 2. 공휴일 API 장애 대응

### 현재 방어 체계
- **Firestore 캐시 우선**: `system/holidays` 문서에서 먼저 조회
- `syncHolidaysScheduled` Cloud Function이 **매일 06:00**에 API 호출 → Firestore에 저장
- API 실패해도 **기존 Firestore 데이터**로 정상 동작

### 장애 시 조치
1. Firestore Console → `system` → `holidays` 문서 확인
2. 수동 입력: 해당 연도의 공휴일을 `{ "YYYY-MM-DD": "공휴일명" }` 형태로 직접 추가
3. 기관별 커스텀 휴일(`organizations/{orgId}/customHolidays`)은 API와 무관

### 최악의 상황
- API 영구 폐기 시: `syncHolidays.js`에서 대체 API URL로 변경
- 또는 매년 초 공휴일 목록을 수동으로 Firestore에 입력 (연 1회 작업)

---

## 3. 알림톡 API (알리고) 장애 대응

### 현재 방어 체계
- **PHP 프록시 패턴**: Cafe24 호스팅의 PHP 프록시를 경유하여 알리고 API로 전송. API 키가 Cloud Functions에 직접 노출되지 않음
- **환경변수 분리**: `ALIMTALK_PROXY_URL`, `ALIMTALK_PROXY_TOKEN`으로 프록시 URL과 인증 토큰 분리 관리
- **에러 로깅**: 발송 실패 시 상세 에러 로그 기록, 일괄 발송 시 개별 실패 건만 카운트 (전체 실패 방지)

### 장애 시 조치
1. 알리고 관리자 페이지(https://smartsms.aligo.in)에서 API 상태 확인
2. Cafe24 PHP 프록시 파일 정상 동작 여부 확인
3. 알리고 API 인증키/발신 프로필 만료 여부 → 알리고 콘솔에서 갱신
4. `functions/.env`의 `ALIMTALK_PROXY_URL`, `ALIMTALK_PROXY_TOKEN` 값 확인

### 사용자 영향
- 기관 승인/리마인드 알림톡이 발송되지 않음 → **이메일 알림은 별도 경로(EmailJS)로 정상 동작**
- 서비스 핵심 기능(운행일지, 예약 등)에는 영향 없음

---

## 비상 연락처

| 서비스 | 문의 |
|--------|------|
| TMap API | https://openapi.sk.com → 고객센터 |
| 공공데이터 포털 | https://www.data.go.kr → 문의하기 |
| 알리고 (알림톡) | https://smartsms.aligo.in → 고객센터 |
