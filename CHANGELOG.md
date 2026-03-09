# 📋 변경 이력 (CHANGELOG)

이 문서는 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따릅니다.

---

## Phase 30 — 운영 개선 & 사용성 강화 & 컨텐츠 갱신 🛠️

### Added
- 시스템 관리자 대시보드에 OCR vs 수동 입력 시계열 그래프 (`ServiceDashboard.tsx`)
- 거절된 신청 → 보류(pending) 되돌리기 버튼
- 고유번호 "82" 포함 + "교회" 미포함 시 자동 보류 로직
- 사용자 매뉴얼에 YouTube 영상 가이드 링크 (`manualSections.ts`)
- 기관 대시보드 테이블 컬럼별 정렬 기능

### Changed
- 랜딩 페이지 경고 메시지 통합 (영리 기업 + 종교단체 → 단일 메시지)
- 랜딩 페이지 부가 기능 칩 확대 (즐겨찾기, 글꼴 크기, 매뉴얼·영상, 의견 보내기)
- 인앱 브라우저 첫 페이지 인앱 내 허용, 이후 외부 유도
- README.md 전면 갱신 (TypeScript, Gemini 3.1, 용어 통일, Cloud Functions 보강)

### Fixed
- Sentry: Facebook 인앱 `Java object is gone` 에러 무시
- E2E: 랜딩 페이지 스크롤 처리 추가 (`landing.spec.ts`)
- 단위 테스트: `manualSections.test.ts` 허용 타입에 `link` 추가

---

## Phase 24 — 다중 목적지 & 접근성 & 품질 강화 🎯

### Added
- 다중 목적지 경로 탐색 (`tmap.js` — `parseDestinations`, `getMultiRoute`, `getTmapDeeplink`)
- 글꼴 크기 조절 기능 (`FontSizeContext.jsx` — 소/중/대 3단계, `MorePage.jsx` 설정 UI)
- Cloud Functions 테스트 4개 (`functions/__tests__/` — 예약 생성/헬퍼/알림/전송)
- React 훅 테스트 3개 (`useDriveLogForm`, `useReservationCalendar`, `useTodayDashboard`)
- 예약 화면 즐겨찾기 등록 버튼

### Changed
- OCR 모델 업그레이드: `gemini-3.1-flash-lite-preview` (`ocrDashboard.js`, `ocrDocument.js`)
- 목적지 입력 placeholder 축약 (모바일 가독성 향상)
- Firestore 보안 규칙 정비 (즐겨찾기/예약 권한 검증 강화)
- Firestore 복합 인덱스 추가 (신규 쿼리 패턴)

### Fixed
- 달력 2~3일째 행 높이 불일치 스타일 버그 (`CalendarGrid.jsx`)
- IndexedDB 오류 시 graceful fallback 처리 (`firebase.js`)

---

## Phase 16 — 기능 정비 및 UX 고도화 🔨

### Removed
- 전자결재 시스템 전면 제거 (`ApprovalList.jsx` 삭제, 관련 라우트/코드 정리)

### Added
- 예약 없이 바로 운행 시작 (`QuickDriveStart.jsx` + `useQuickDriveStart.js`)
- 서버사이드 예약 중복 방지 (`createReservationSafe.js` — Firestore 트랜잭션)
- 차량 퇴역/복귀 기능 (`vehicles.status` 필드, `VehicleManager.jsx` 액션)
- 정비 중 차량 사용 차단 (`MaintenanceLog.jsx` — `blockVehicle`/`maintenanceEndDate` 필드)
- 차량 타임라인 바 (`VehicleTimelineBar.jsx` — 예약 간 빈 시간대 시각화)
- 기관 신청 알림 (`notifyNewApplication.js` — 슈퍼관리자 FCM 푸시)
- 의견 관리 실시간 배지 (슈퍼관리자 사이드바)
- PWA 설치 안내 (`IOSInstallPrompt.jsx`, `InstallPrompt.jsx`)
- 인앱 브라우저 감지 + 외부 열기 유도 (`inAppBrowser.js`)
- 안드로이드 뒤로가기 버튼 처리 (`useBackButton.js`)
- 라이트 모드 강제 적용 훅 (`useForceLightMode.js`)
- 관리자 예약 관리 (전 직원 예약 조회/수정/취소, 예약자 변경)

### Changed
- 예약/신청 목록 실시간 업데이트 (`onSnapshot` 적용)
- 다크 모드 soft 버튼 스타일 일괄 수정 (`dark:` 변형 추가)
- PDF 결재란 커스터마이징 (담당/팀장/관장 등 설정 → PDF 반영)
- 정비 기록 UI — 차량 정보 강조 표시
- 활동 랭킹 색상 통일 (금/은/동 → 단일 색상)
- 공지 아이콘 📋 → 🎤 변경

### Fixed
- 운행일지 소급 입력 시 출발Km 오류 및 누적Km 덮어쓰기 버그

---

## Phase 15 — 문서 및 지식 관리 📚

> 프로젝트 지속 가능성을 위한 문서 정비 완료.

### Added
- `README.md` 최신화 (기능 테이블, CI/CD, Functions 목록)
- `OPERATIONS.md` 운영 가이드
- `CONTRIBUTING.md` 기여 가이드
- `CHANGELOG.md` 변경 이력 (Keep a Changelog 형식)

---

## Phase 14 — 인프라 및 배포 자동화 ⚙️

### Added
- GitHub Actions CI/CD 파이프라인 (`ci.yml`, `deploy.yml`, `preview.yml`)
- Firebase Preview Channel로 PR별 스테이징 환경
- Dependabot 주간 의존성 보안 스캔 (`.github/dependabot.yml`)
- `scripts/security-audit.js` — npm 보안 감사 리포트
- `scripts/check-functions-health.js` — Cloud Functions 에러 빈도 분석

---

## Phase 13 — 신규 기능 추가 🌟

### Added
- Google Calendar 역동기화 (`syncCalendarToApp` 10분 주기)
- 예약 출처 뱃지 ("📅 캘린더") `ReservationSidePanel.jsx`
- 예약 취소/변경 시 앱 내 알림 + FCM 푸시 자동 전송
- 관리자 공지 기능 (`AdminNotice.jsx` + `sendAdminNotice.js`)
- `NotificationBell` type별 아이콘 (✅❌🚫✏️📢ℹ️)

---

## Phase 12 — 운영 품질 강화 📈

### Added
- PWA 스크린샷 자동 생성 (`scripts/generate-screenshots.js`, Playwright + sharp)
- E2E 테스트 확대: `landing.spec.js`(8개), `terms-privacy.spec.js`(5개)
- 번들 크기 모니터링 (`scripts/check-bundle-size.js`, JS 600KB / CSS 60KB 예산)

### Changed
- Lighthouse 접근성 개선: `index.html` preconnect 힌트, aria 속성 보강

---

## Phase 11 — PWA 안전성 개선 및 보안 강화 🔧

### Changed
- PWA registerType `autoUpdate` → `prompt` 전환
- FCM SW 빌드 시 `.env` 자동 주입 (`generate-sw-config.js`)
- CSP 인라인 스크립트 → 외부 `sw-purge.js`로 분리
- Firebase API Workbox 캐시 제거 (Firestore SDK 자체 캐시와 중복)

### Added
- PNG 앱 아이콘 생성 (`icon-192.png`, `icon-512.png`)
- IndexedDB 선별 삭제 (`sw-purge.js`)
- Manifest 스크린샷 경로 등록

---

## Phase 10 — UX/안정성 패치 🔧

### Fixed
- iOS Safari `Notification` API 미지원 가드
- FCM Service Worker 등록 에러
- KST 날짜 인식 오류 (전일 표시)
- 다크 모드 폼/닫기 버튼 색상
- superAdmin 불필요 예약 알림 발송 중단
- soft delete 기관 통계 카운팅 제외

### Changed
- 예약 폼 필드 순서: 행선지 → 목적 → 시작 → 종료
- 화면 레이아웃 통일 (예약/더보기 → 오늘 화면 스타일)
- 대시보드 운행/예약 분리 표시
- 기관 신청 페이지 뒤로가기 버튼 추가
- 카드 디자인 모바일 반응형 개선

---

## Phase 9 — 서비스 운영 및 성장 🚀

### Added
- 다중 관리자 지원 (기관당 admin 2명+)
- 전자결재 워크플로우 (`ApprovalList.jsx`)
- 고도화 분석 대시보드 (`AnalyticsDashboard.jsx` — 트렌드/비용 최적화)
- 다크 모드 (`ThemeContext` + 개인 설정 Firestore 저장)
- 데이터 아카이빙 (`archiveDriveLogs.js` — 3년+ 기록 GCS 이동)

### Changed
- 온보딩 위자드 + 웰컴 가이드 + Empty State 개선

---

## Phase 8 — 서비스 운영 기반 🏢

### Added
- Firestore 자동 백업 (`backupFirestore.js` — 매일 03:00 KST)
- 기관 soft delete + 30일 복구 (`autoPurgeOrgs.js`)
- 삭제 기관 → 소속 사용자 실시간 로그인 차단
- 슈퍼관리자 서비스 대시보드 (`ServiceDashboard.jsx`)
- 이용약관 + 개인정보 처리방침 (`/terms`, `/privacy`)
- Firestore 오프라인 캐시 (`persistentLocalCache`)
- PWA 자동 업데이트 배너 (`UpdatePrompt.jsx`)
- AI OCR Fallback UX ("수동 입력하기" 버튼)
- 대용량 출력 방어 (최대 3개월 제한)

---

## Phase 7 — 안정성 강화 및 테스트 🔒

### Added
- Sentry 에러 모니터링 연동
- FCM 푸시 알림 완성 (Service Worker + 토큰 관리)
- 단위 테스트 11개 (Vitest), E2E 테스트 (Playwright)
- 예약 푸시 알림 (`reservationReminder.js` — 5분 주기)
- 일지 미작성 푸시 알림

### Changed
- PWA manifest 보강 (maskable 아이콘, id)
- Firestore 보안 규칙 확장 (feedbacks/users/favorites)

---

## Phase 6.5 — UX 개선 및 안정성 🛡️

### Added
- Skeleton UI, 에러 바운더리, 오프라인 배너
- 토스트 알림 (`useToast.jsx` — 성공/에러/경고, 중복 방지)
- 피드백 시스템 (사용자 제출 + 슈퍼관리자 관리)
- 앱 내 사용자 매뉴얼 (`UserManual.jsx`)
- Sentry 연동 + FCM 알림 훅 + 알림 전송 Function
- 공휴일 API 프록시 (`holidayProxy.js`) + 자동 동기화

### Fixed
- CSV 다운로드 날짜 컬럼 누락

---

## Phase 6 — 출력 및 부가 기능 📊

### Added
- 운행일지 PDF 출력 (공식 양식 A4 가로, 결재란, 자동 페이지 분할)
- 운행일지 Excel 다운로드 (기간 필터)
- 결재란 커스터마이징 (`Settings.jsx`)
- 월별 통계 대시보드 (`MonthlyReport.jsx` — 차트 + 추이)
- 예약 임박/미작성 알림 (클라이언트)
- 차량 정비 기록 CRUD (`MaintenanceLog.jsx`)

---

## Phase 5 — 차량 예약 시스템 📅

### Added
- 달력 UI 예약 시스템 (`ReservationCalendar.jsx`)
- 예약 CRUD (생성/조회/수정/취소, 실시간 구독)
- 시간대 충돌 방지
- 운행 시작 워크플로우 (예약 → in_progress → 일지 작성)
- 오늘 대시보드 (`TodayDashboard.jsx`)
- 구글 캘린더 연동 (`calendarSync.js`)

---

## Phase 4 — AI & 외부 연동 🤖

### Added
- 계기판 OCR (`ocrDashboard.js` — Gemini Vision → Km/배터리%)
- 고유번호증 AI 분석 + 자동 승인 (`autoVerifyDocument.js`)
- 서버사이드 이메일 발송 (`@emailjs/nodejs`)
- 티맵 딥링크 + 경로 탐색 (`tmap.js`, `tmapProxy.js`)

---

## Phase 3 — 운행일지 핵심 기능 📝

### Added
- 운행일지 작성 폼 (`DriveLogForm.jsx`)
- 출발Km 자동 입력 + 도착Km 트랜잭션 업데이트
- 내 기록 목록/수정 (`MyRecords.jsx`)
- 관리자 운행일지 조회/검색/수정 (`DriveLogList.jsx`)
- 사용목적 프리셋, 예약→운행일지 연동
- 목적지 즐겨찾기, 동승자 빠른 선택, 이어서 기록

---

## Phase 2 — 기관 관리 기능 👥

### Added
- 직원 관리 CRUD (`EmployeeManager.jsx`)
- 초대 코드 시스템 (6자리 코드 생성/재발급)
- 차량 관리 CRUD (`VehicleManager.jsx`)
- 기관관리자/슈퍼관리자 레이아웃
- 기관 관리 + 기관 설정 (결재란, 공휴일)

---

## Phase 1 — 프로젝트 기반 구축 🏗️

### Added
- Vite + React 프로젝트 생성
- Firebase 연동 (Auth, Firestore, Hosting, Storage)
- 구글 로그인 (`LoginPage.jsx`)
- 역할 기반 라우팅 (superAdmin / admin / employee)
- 기관 신청 + 승인 시스템
- 앱 내 알림 (`NotificationBell.jsx`)
- Firestore 보안 규칙
- 공휴일 API 연동
