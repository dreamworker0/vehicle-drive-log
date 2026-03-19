# 🚗 차량 운행일지

사회복지기관·비영리단체를 위한 **무료** 차량 운행일지 웹 애플리케이션 (PWA)

> **서비스 URL**: [vehicle-drive-log.web.app](https://vehicle-drive-log.web.app)

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 📝 운행일지 자동화 | 계기판 OCR 촬영으로 주행거리 자동 입력, 목적 프리셋, 동승자 선택, 이어서 기록 |
| 📅 차량 예약 시스템 | 달력 UI, 시간대 충돌 방지, 구글 캘린더 양방향 동기화, 서버사이드 동시성 안전 |
| 📊 통계 & 출력 | 월별·직원별·목적별 통계, 공식 양식 PDF/Excel 다운로드, 결재란 커스터마이징 |
| 📱 앱처럼 설치 | iPhone/Android 홈 화면에 추가하여 네이티브 앱처럼 사용 (PWA) |
| 🤖 AI 기관 인증 | 고유번호증/사업자등록증 OCR → 자동 승인/거절 (영리 기업 자동 차단) |
| 🗺️ 길안내 연동 | 네이버/카카오/티맵 딥링크, 다중 목적지 경로 탐색 (거리·시간·톨비) |
| 📴 오프라인 지원 | Firestore 오프라인 캐시, 연결 복구 시 자동 동기화 |
| 🔔 푸시 알림 | 예약 10분 전 알림, 운행일지 미작성 알림, 관리자 공지 (FCM) |
| 📱 카카오 알림톡 | 기관 승인·리마인드 알림톡 자동 발송 (알리고 API) |
| 🔧 차량 정비 관리 | 정비/수리 기록, 정비 중 차량 사용 차단 |
| ⛽ 주유·하이패스 | 주유 기록, 하이패스 충전 관리, 통계 차트 |
| 🌙 다크 모드 | 시스템/사용자 설정 기반 다크 모드, 글꼴 크기 3단계 조절 |

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드 | Vite 7 + React 19 + TypeScript |
| 스타일링 | TailwindCSS v3 (반응형, 다크 모드) |
| 언어 | TypeScript (프론트엔드 + Cloud Functions + 테스트 + 스크립트) |
| 인증 | Firebase Auth (Google 로그인 전용) |
| 데이터베이스 | Cloud Firestore (실시간 구독 + 오프라인 캐시) |
| 서버리스 | Cloud Functions for Firebase (TypeScript ESM, Node.js 22) |
| AI/OCR | Gemini 3.1 Flash Lite Preview (Cloud Functions 경유) |
| 호스팅 | Firebase Hosting |
| 모니터링 | Sentry (프론트엔드 에러 + Web Vitals) |
| 알림톡 | 알리고 API + Cafe24 PHP 프록시 (카카오 알림톡) |

---

## 사용자 역할

| 역할 | 권한 |
|------|------|
| 시스템 관리자 | 기관 신청 승인/거절, 기관·사용자 관리, 서비스 대시보드 |
| 기관관리자 | 직원·차량 관리, 운행일지 조회/수정/출력, 차량 예약, 설정 |
| 기관직원 | 운행일지 작성(OCR), 차량 예약, 길안내, 내 기록 조회 |

---

## 시작하기

### 사전 요구사항

- **Node.js 22 LTS** (필수, Node 24에서 Rollup 빌드 실패)
- Firebase CLI (`npm i -g firebase-tools`)
- `fnm use 22`로 Node 버전 전환 권장

### 설치

```bash
npm install
cd functions && npm install && cd ..
```

### 환경변수 설정

루트에 `.env` 파일 생성:

```env
# Firebase
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

# EmailJS (프론트 수동 이메일)
VITE_EMAILJS_SERVICE_ID=...
VITE_EMAILJS_TEMPLATE_ID=...
VITE_EMAILJS_PUBLIC_KEY=...

# 티맵 API
VITE_TMAP_APP_KEY=...

# 공휴일 API
VITE_HOLIDAY_API_KEY=...

# Sentry
VITE_SENTRY_DSN=...

# FCM
VITE_FIREBASE_VAPID_KEY=...
```

`functions/.env` 파일:

```env
GEMINI_API_KEY=...
EMAILJS_SERVICE_ID=...
EMAILJS_TEMPLATE_ID=...
EMAILJS_PUBLIC_KEY=...
EMAILJS_PRIVATE_KEY=...
HOLIDAY_API_KEY=...
ALIMTALK_PROXY_URL=...
ALIMTALK_PROXY_TOKEN=...
```

---

## npm 스크립트

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버 실행 (Vite, localhost:5173) |
| `npm run build` | 프로덕션 빌드 (prebuild: SW 설정 생성, postbuild: 번들 크기 체크) |
| `npm run lint` | ESLint 실행 |
| `npm test` | 단위 테스트 (Vitest) |
| `npm run test:e2e` | E2E 테스트 (Playwright) |
| `npm run screenshots` | PWA 스크린샷 생성 (Playwright + sharp) |
| `npm run audit` | npm 보안 감사 리포트 |
| `npm run health` | Cloud Functions 상태 점검 |

---

## 배포

```bash
# 전체 배포 (프론트 + Functions + Rules)
fnm use 22
npm run build
firebase deploy

# Cloud Functions만 배포
firebase deploy --only functions

# 보안 규칙만 배포
firebase deploy --only firestore:rules,storage
```

> ⚠️ 배포 전 반드시 Node 22 확인: `fnm use 22 && node --version`

---

## 프로젝트 구조

```
차량운행일지/
├── public/
│   ├── firebase-messaging-sw.js      FCM Service Worker
│   ├── manifest.json                 PWA 매니페스트
│   └── icons/                        앱 아이콘
├── src/
│   ├── App.tsx                       역할별 라우팅 + 랜딩 페이지
│   ├── index.css                     TailwindCSS + 커스텀 스타일
│   ├── main.tsx                      앱 진입점 (Sentry 초기화)
│   ├── components/
│   │   ├── auth/                     인증 (로그인, 초대코드, 기관 신청, 랜딩)
│   │   ├── superAdmin/               시스템 관리자 화면 (기관 관리, 대시보드)
│   │   ├── admin/                    기관관리자 화면 (운행일지, 통계, 분석)
│   │   ├── employee/                 직원 화면 (모바일 최적화)
│   │   └── common/                   공통 (알림, 달력, 에러, 오프라인)
│   ├── contexts/                     React 컨텍스트
│   │   ├── ThemeContext.tsx           다크/라이트 모드 관리
│   │   ├── FontSizeContext.tsx        글꼴 크기 조절 (소/중/대)
│   │   └── ConfirmContext.tsx         Promise 기반 커스텀 confirm 모달
│   ├── hooks/                        커스텀 훅 (비즈니스 로직 분리)
│   ├── lib/                          유틸리티 (Firestore, 티맵, OCR, PDF/Excel)
│   │   └── firestore/                Firestore CRUD (도메인별 분리)
│   └── __tests__/                    단위 테스트 (Vitest)
├── functions/                        Cloud Functions (TypeScript ESM)
│   └── src/                          소스 (빌드 → functions/lib/)
├── e2e/                              E2E 테스트 (Playwright)
├── scripts/                          빌드/운영 스크립트
└── .github/workflows/                CI/CD 파이프라인
```

---

## Cloud Functions

### 호출형 (onCall)

| 함수명 | 용도 |
|--------|------|
| `ocrDashboard` | 계기판 사진 → Gemini OCR → Km/배터리% 추출 |
| `createReservationSafe` | 서버사이드 예약 생성 (Firestore 트랜잭션, 동시성 안전) |
| `sendAdminNotice` | 관리자 공지 FCM 전송 |
| `sendBulkReminder` | 미활성 기관 일괄 알림톡 발송 (superAdmin 전용) |
| `disableUser` | 사용자 비활성화 (Firebase Auth + Firestore) |
| `restoreUser` | 비활성화된 사용자 복원 |
| `joinOrganization` | 초대 코드로 기관 가입 (서버사이드 권한 처리) |

### Firestore 트리거

| 함수명 | 용도 |
|--------|------|
| `autoVerifyDocument` | 고유번호증 AI 분석 → 자동 승인/거절 → 이메일 |
| `notifyNewApplication` | 신규 기관 신청 시 시스템 관리자 FCM 알림 |
| `onReservationCreated` | 예약 생성 → 구글 캘린더 동기화 + FCM 알림 |
| `onReservationUpdated` | 예약 수정/취소 → 캘린더 업데이트 |
| `onReservationDeleted` | 예약 삭제 → 캘린더 이벤트 삭제 |
| `setCustomClaims` | 사용자 문서 변경 시 Firebase Auth Custom Claims 자동 동기화 |

### 스케줄 함수

| 함수명 | 주기 | 용도 |
|--------|------|------|
| `reservationReminder` | 5분 | 예약 10분 전 FCM + 일지 미작성 FCM |
| `syncCalendarToApp` | 10분 | 구글 캘린더 → Firestore 역동기화 |
| `backupFirestore` | 매일 03:00 | Firestore 전체 → Cloud Storage 백업 |
| `autoPurgeOrgs` | 매일 04:00 | soft delete 30일 경과 기관 영구 삭제 |
| `archiveDriveLogs` | 매일 04:30 | 3년+ 운행 기록 GCS 아카이빙 |
| `cleanupCertificateImages` | 매일 04:00 | 승인 30일 경과 기관 고유번호증 이미지 삭제 |
| `syncHolidaysScheduled` | 매일 06:00 | 공공데이터포털 공휴일 캐시 |

### HTTP 함수

| 함수명 | 용도 |
|--------|------|
| `holidayProxy` | 공휴일 API CORS 프록시 |
| `tmapProxy` | 티맵 경로 탐색 프록시 |
| `warmupOcr` | OCR 함수 콜드 스타트 방지 |
| `cleanupDuplicateLogs` | 중복 운행 기록 탐지 및 정리 |
| `migrateCustomClaims` | 기존 사용자 Custom Claims 일괄 설정 (1회성) |

---

## 테스트

| 종류 | 규모 | 도구 |
|------|------|------|
| 단위 테스트 | 35파일, 266개 | Vitest |
| E2E 테스트 | 8파일, 40개 | Playwright |

---

## 관련 문서

| 문서 | 설명 |
|------|------|
| [구현계획서.md](구현계획서.md) | 전체 설계 문서 (아키텍처, DB 스키마, API 명세, 시퀀스 다이어그램) |
| [OPERATIONS.md](OPERATIONS.md) | 시스템 관리자용 운영 매뉴얼 (백업, 장애 대응, 기관 관리) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 개발 참여 가이드 (코딩 컨벤션, PR 규칙, 브랜치 전략) |
| [CHANGELOG.md](CHANGELOG.md) | Phase별 변경 이력 |
| [API_FALLBACK.md](API_FALLBACK.md) | 외부 API 장애 대응 매뉴얼 |
| [TYPESCRIPT_MIGRATION.md](TYPESCRIPT_MIGRATION.md) | TypeScript 전환 가이드 및 코드 패턴 |

---

## 서비스 URL

| 환경 | URL |
|------|-----|
| 프로덕션 | `https://vehicle-drive-log.web.app` |
| 개발 서버 | `http://localhost:5173` |

## 라이선스

비공개 프로젝트
