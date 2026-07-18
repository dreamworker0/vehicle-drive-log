# 셀프호스팅 가이드 (Self-Hosting)

이 문서는 **자기 기관·단체의 Firebase 프로젝트에 차량 운행일지를 직접 배포**하려는 분을 위한 안내입니다. 개발 컨벤션은 [CONTRIBUTING.md](../CONTRIBUTING.md), 운영은 [OPERATIONS.md](../OPERATIONS.md)를 참고하세요.

> 이 프로젝트는 **멀티테넌트**입니다. 한 번 배포하면 여러 기관이 각자 계정으로 나눠 쓸 수 있으므로, 지역 복지관 연합체나 자원봉사 개발자가 **여러 소규모 기관을 위해 한 인스턴스만 운영**하는 것도 가능합니다.

---

## 0. 전체 흐름 한눈에

```
Firebase 프로젝트 생성 → 서비스 활성화 → 설정값을 .env로 복사
  → 로컬 실행 확인 → 배포 → 첫 시스템 관리자 지정
```

소요 시간: 처음이면 약 1~2시간. Firebase 콘솔 작업이 대부분입니다.

---

## 1. 사전 요구사항

- **Node.js 22 LTS** (Node 24는 Rollup 빌드 실패 — `fnm use 22` 권장)
- **Firebase CLI** — `npm i -g firebase-tools`
- **Google 계정** (Firebase 프로젝트 소유)
- **Gemini API 키** — [Google AI Studio](https://aistudio.google.com/apikey)에서 무료 발급 (OCR 기능에 필요)

---

## 2. Firebase 프로젝트 만들기

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 **프로젝트 추가**
2. **Blaze 요금제**로 업그레이드 — Cloud Functions는 종량제(Blaze)가 필수입니다. 소규모 기관 사용량은 대부분 무료 한도 안에 들어오지만, 카드 등록은 필요합니다.
3. 아래 서비스를 활성화합니다.

| 서비스 | 콘솔 위치 | 설정 |
|--------|-----------|------|
| **Authentication** | 빌드 → Authentication | Google 로그인 제공업체 사용 설정 |
| **Firestore** | 빌드 → Firestore Database | 프로덕션 모드로 생성 (규칙은 배포 시 덮어씀) |
| **Storage** | 빌드 → Storage | 기본 버킷 생성 (OCR 이미지·백업 저장) |
| **Cloud Functions** | 빌드 → Functions | Blaze면 자동 사용 가능 |
| **Hosting** | 빌드 → Hosting | 웹 앱 배포 대상 |
| **Cloud Messaging** | 프로젝트 설정 → 클라우드 메시징 | 웹 푸시 인증서(VAPID 키) 생성 → `VITE_FIREBASE_VAPID_KEY` |
| **App Check** | 빌드 → App Check | reCAPTCHA v3 등록 (선택이지만 권장 — 하단 §6 참고) |

4. **웹 앱 등록** — 프로젝트 설정 → 내 앱 → 웹 앱 추가. 표시되는 `firebaseConfig` 값이 아래 `.env`의 `VITE_FIREBASE_*` 입니다.

---

## 3. 코드 내려받기 & 의존성 설치

```bash
git clone https://github.com/dreamworker0/vehicle-drive-log.git
cd vehicle-drive-log
fnm use 22
npm install
cd functions && npm install && cd ..
```

프로젝트를 자기 Firebase에 연결:

```bash
firebase login
firebase use --add    # 방금 만든 프로젝트 선택 (별칭: default)
```

---

## 4. 환경변수 설정

### 4-1. 최소 필수 (이것만 있으면 앱이 뜹니다)

루트 `.env`:

```env
# Firebase 웹 설정 (프로젝트 설정 → 웹 앱의 firebaseConfig)
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
# 웹 푸시 (Cloud Messaging → 웹 푸시 인증서)
VITE_FIREBASE_VAPID_KEY=...
```

`functions/.env`:

```env
# OCR — 계기판·증빙 인식의 핵심. 없으면 OCR 기능만 동작하지 않습니다.
GEMINI_API_KEY=...
```

### 4-2. 선택 (해당 기능을 쓸 때만)

| 기능 | 변수 | 없으면 |
|------|------|--------|
| 길안내(티맵 경로·톨비) | `VITE_TMAP_APP_KEY` | 딥링크는 되지만 앱 내 경로 탐색 비활성 |
| 반복 예약 시 공휴일 제외 | `VITE_HOLIDAY_API_KEY`, `functions` 쪽 `HOLIDAY_API_KEY` | 공휴일 자동 제외 안 됨 |
| 에러 모니터링 | `VITE_SENTRY_DSN` | Sentry 미전송 (기능엔 영향 없음) |
| 승인/알림 이메일 | `VITE_EMAILJS_*`, `functions`의 `EMAILJS_*` | 이메일 발송 생략 |
| 카카오 알림톡 | `functions`의 `ALIMTALK_PROXY_URL`, `ALIMTALK_PROXY_TOKEN` | 알림톡 미발송 (§7 한국 특화 참고) |

> `.env`·`functions/.env`는 `.gitignore`로 커밋되지 않습니다. 절대 저장소에 올리지 마세요.

---

## 5. 로컬 확인 → 배포

```bash
# 로컬 실행
npm run dev            # http://localhost:5173

# 배포 (Node 22 필수)
fnm use 22
npm run build
firebase deploy        # 프론트 + Functions + Rules + 인덱스 전체
```

> ⚠️ 이 저장소의 원본 운영은 CI를 통해 배포하지만(README·CLAUDE.md 참고), **셀프호스터는 위 `firebase deploy`를 직접 실행**하면 됩니다.

부분 배포:

```bash
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules,storage
firebase deploy --only firestore:indexes
```

---

## 6. 첫 시스템 관리자 지정

배포 후 처음 Google 로그인한 사용자는 일반 사용자입니다. **최초 1명을 시스템 관리자로 승격**해야 기관 신청 승인 등을 할 수 있습니다.

1. 앱에 한 번 로그인해 본인 사용자 문서를 생성합니다.
2. Firebase 콘솔 → Firestore → `users` 컬렉션에서 본인 문서를 찾습니다.
3. `role` 필드를 `superAdmin`으로 변경합니다.
4. 다시 로그인하면 시스템 관리자 화면이 나타납니다. (Custom Claims는 `setCustomClaims` 트리거가 자동 동기화)

이후 기관 신청·직원 초대는 앱 안에서 처리됩니다.

---

## 7. App Check (권장)

멀티테넌트 데이터는 Firestore 보안 규칙으로 보호되지만, App Check를 켜면 **정상 앱이 아닌 요청을 차단**해 남용을 추가로 막습니다.

1. 콘솔 → App Check → 웹 앱에 **reCAPTCHA v3** 등록
2. 개발 중에는 디버그 토큰 사용 — [.env.local.example](../.env.local.example)의 `VITE_APPCHECK_DEBUG_TOKEN` 참고
3. 관찰 기간을 두고 문제없으면 Firestore → Functions 순으로 **강제(enforce)** 로 전환

또한 배포 후 **웹 API 키에 HTTP 리퍼러 제한**을 거는 것을 권장합니다 (Google Cloud 콘솔 → API 및 서비스 → 사용자 인증 정보 → Browser key → 애플리케이션 제한사항 → 웹사이트: 자기 도메인 + `localhost:5173/*`).

---

## 8. 한국 특화 기능 참고

이 앱은 한국 사회복지기관 환경에 맞춰져 있어, 아래 기능은 그대로 쓰려면 한국 서비스가 필요합니다. 다른 지역이라면 **비활성(env 미설정) 또는 코드 수정**으로 대응하세요.

- **AI 기관 인증** — 고유번호증/사업자등록증 OCR로 비영리 여부를 판별합니다(사업자번호 중간 `82`=비영리). 한국 사업자번호 체계 기준이라 다른 국가에는 맞지 않습니다.
- **카카오 알림톡** — 알리고 API + Cafe24 PHP 프록시를 경유합니다. 한국 카카오 채널·알리고 계정이 필요합니다. 없으면 이메일/FCM 알림만 사용하세요.
- **공휴일 API·티맵** — 한국 공공데이터/티맵 기반입니다.

이 기능들을 끄면 **운행일지·예약·통계·PDF/Excel 출력·푸시** 같은 핵심은 어느 지역에서든 동작합니다.

---

## 9. 다른 용도로 응용하기

핵심 뼈대는 **"공유 자산 예약 + 사용 기록 + OCR 자동입력 + 통계/출력"** 입니다. 도메인 파일([src/lib/firestore/](../src/lib/firestore/))과 타입([src/types/](../src/types/))을 바꾸면 다음으로 응용할 수 있습니다.

- 관용차 관리(공공기관), 학교 통학·종교기관 차량
- 차량 → 회의실·장비·공용 물품 예약/사용대장
- 계기판 OCR → 검침·영수증 등 다른 촬영 입력

---

## 문제가 생기면

- 배포·빌드 오류: [docs/API_FALLBACK.md](API_FALLBACK.md), 저장소 [Issues](https://github.com/dreamworker0/vehicle-drive-log/issues)
- 보안 취약점: [SECURITY.md](../SECURITY.md) (공개 이슈 대신 비공개 제보)
