# 📋 변경 이력 (CHANGELOG)

이 문서는 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따르는 **개발 참고용** 이력입니다.
서비스 이용자용 변경 소식은 [업데이트 소식](https://vehicle-drive-log.web.app/release-notes)에서 확인할 수 있습니다.

---

## Phase 48 — 성능 최적화 및 타입 안정성 패치 🚀

> 2026-05-15

### Changed
- **관리자 대시보드 성능 최적화**: 슈퍼관리자의 기관 목록 조회 시 `limit(100)` 안전장치를 추가하여 비정상적인 풀스캔 및 과부하 방지 (`organizations.ts`)
- **운행일지 리스트 최적화**: `useDriveLogList` 훅 내의 필터링 및 합계 계산 로직에 `useMemo`를 도입하여 불필요한 리렌더링 및 재계산 성능 저하 방지
- **타입 시스템 정비**: `DriveLogTableRow.tsx`와 `useDriveLogList.ts`에 산재해 있던 중복 `DriveLogEntry` 인터페이스를 `src/types/driveLog.ts`로 통합 분리하여 코드 중복 제거 및 타입 일관성 확보
- **초기 번들 사이즈 최적화**: 릴리즈 노트와 매뉴얼 데이터를 JSON으로 분리하고 Lazy Loading 적용. 이미지 압축 라이브러리 비동기 청크 분할 (메인 번들 약 60KB+ 축소)
- **백엔드 모놀리식 모듈 분할**: 773줄 규모의 `computeDashboardStats`를 헬퍼 및 섹션 모듈 분할. 586줄 규모의 `autoVerifyDocument` 비즈니스 로직(마스킹, 지오코딩, 알림)을 순수 함수로 추출 (`verifyHelpers`)하여 유지보수성 및 단위 테스트 기반 확보
- **프론트엔드 비즈니스 로직 최적화**: `useVehicleManager` 훅 내부의 차량 정적 모델 데이터 및 판별 로직을 `vehicleModelData.ts` 순수 유틸리티로 분리하여 훅 책임 완화 및 가독성 향상
- **데이터 내보내기 안전성 강화**: 운행일지 엑셀/PDF 내보내기 시 성능 및 과금 방지를 위한 최대 5,000건 상한 로직 추가 및 기간 검색 필수화 (`queries.ts`)
- **코드베이스 정리**: 미사용 중인 예약 실시간 구독 함수(`subscribeReservations`, `subscribePendingReservations`) 제거 (`reservations.ts`)

### Fixed
- **E2E 테스트 안정화**: 기관 신청 플로우(`org-application.spec.ts`)에서 약관 동의 시 체크박스 상태가 즉각 반영되지 않아 제출 버튼 클릭 시 타임아웃이 발생하던 문제 해결 (강제 클릭 처리 및 명시적 상태 대기 추가)

---

## Phase 47 — 로그인/인증 안정성 패치 🛡️

> 2026-05-15

### Fixed
- 로그인 시 토큰 Claims 갱신 과정에서 발생할 수 있는 무한 로딩 버그 수정 (백그라운드 갱신 처리 및 fire-and-forget 방식 적용)

---

## Phase 46 — 데이터 무결성 강화 및 오프라인 동기화 아키텍처 개편 🔄

> 2026-05-08

### Added
- **Firestore Trigger 도입**: 운행일지 기록 생성/수정 시 누적 주행거리(currentKm) 및 하이패스 실시간 잔액 동기화 등 주요 Side Effect를 프론트엔드가 아닌 서버사이드 Cloud Functions(`syncDriveLogKm`)에서 처리하도록 이관하여 오프라인 상태 또는 네트워크 단절 시에도 데이터 무결성 100% 보장
- **오프라인 Sync 멱등성(Idempotency) 확보**: 운행 기록 저장 시 클라이언트에서 고유 ID(`{vehicleId}_{uid}_{date}_{startKm}_{endKm}`)를 사전에 발급하여 중복 저장(Race Condition)을 원천 차단

### Changed
- **오프라인 지속성(Offline Persistence) 활용**: 불안정한 커스텀 오프라인 큐(`offlineSyncProcessor`)를 제거하고, Firebase Firestore SDK에 내장된 오프라인 캐시 및 동기화 기능을 100% 활용하도록 아키텍처 전면 개편 (관련 코드 1,000줄 이상 제거)
- **과거 운행기록 수정 프로세스 개선**: 사용자가 과거 기록 수정 시 이전 기록의 종료Km와 새 기록의 시작Km가 불일치할 경우, 백그라운드 자동 덮어쓰기 대신 사용자에게 "수정 확인(Confirm)" 다이얼로그를 명시적으로 노출하여 휴먼 에러 방지 및 투명성 제공
- **Firestore 리스너 및 쿼리 최적화**: 
  - 인증, 유저, 알림, 예약 등 전역 실시간 리스너(`onSnapshot`)에 브라우저 가시성(`visibilitychange`) 이벤트를 결합하여 백그라운드 탭에서의 불필요한 네트워크 통신 및 비용 최소화
  - 운행일지 리스트 및 통계 쿼리 호출 시 `cachedQuery` 유틸리티를 도입하여 중복 읽기 횟수 감소
  - 시스템 관리자 대시보드 상태 관리 훅(`useServiceDashboard`)을 4개의 도메인 단위로 분할하여 React 리렌더링 성능 대폭 개선
- **Cloud Functions 트리거 로직 통합**: 분산되어 있던 `updateAggregatedStats`를 헬퍼 함수로 분리하여 `syncDriveLogKm` 내부로 통합 호출함으로써 불필요한 Cloud Function 웜업 및 중복 실행 비용 절감

### Fixed
- Firebase SDK가 내부적으로 재시도하는 과정에서 발생하는 `AppCheck: Fetch failed to connect to a network` 및 `Requests throttled` 등 단순 인프라 레벨의 네트워크 에러들이 Sentry에 노이즈로 리포트되지 않도록 글로벌 필터링 정책 업데이트
- Hipass 잔액 업데이트 시 기존 절대값 덮어쓰기(last-write-wins)로 인해 다중 기기 환경에서 잔액 데이터가 유실되던 버그를 `increment` 원자적 연산으로 교체하여 완벽 해결
- Firestore 보안 규칙 수정: `system/holidays` 문서에 대해 일반 사용자 읽기 권한을 허용하여, 권한 오류로 인해 불필요하게 실시간 외부 API(`holidayProxy`) 폴백이 호출되던 문제 해결

---

## Phase 45 — 아키텍처 정리 및 프로젝트 품질 대규모 개선 🧹

> 2026-05-06

### Added
- 핵심 백엔드 비즈니스 로직(rateLimit, notifyNewApplication, generateFeedbackDraft, setCustomClaims 등)에 대한 유닛 테스트(Unit Test)를 대거 추가하여 테스트 커버리지 대폭 확대 (전체 50개 테스트 통과)
- `scripts/generate-functions-doc.ts`를 도입하여 Cloud Functions API Reference 문서(`docs/FUNCTIONS_REFERENCE.md`) 자동 생성 파이프라인 구축

### Changed
- 프론트엔드 대형 컴포넌트(`VehicleForm`, `EmployeeManager`)의 핵심 비즈니스 UI(캘린더 연동 영역, 직원 목록 카드)를 각각 독립적인 서브 컴포넌트(`VehicleCalendarSection`, `EmployeeListItem`)로 분리하여 기술 부채 해소
- 프로젝트 최상단 디렉터리에 잔존하던 임시 스크립트 파일(`.cjs`, `.mjs`) 및 테스트 텍스트 결과 파일들을 `scripts/`와 `docs/`로 이동, 또는 `.gitignore` 처리하여 깨끗한 빌드 환경 보장
- 배포 스크립트 및 빌드 검증 파이프라인 내 ES Module(`"type": "module"`) 호환성 오류 수정

## Phase 44 — CI/CD 자동 배포 파이프라인 구축 및 워크플로우 고도화 🚀

> 2026-04-26

### Added
- GitHub Actions 기반의 프로덕션 CI/CD 자동 배포 파이프라인 구축 (`deploy.yml` 작성 및 연동 완료)
- GitHub 저장소 Secrets(환경변수 및 인증키) 연동을 통해 Firebase Hosting 및 Functions 무중단 배포 자동화
- 에이전트 전용 프리-커밋(Pre-commit) 문서 갱신 워크플로우(`git.md`) 추가 (문서 최신화 후 배포 강제화)

### Changed
- 배포 프로세스 전환: 기존 로컬 PC에서의 수동 `firebase deploy` 방식에서 깃허브 `master` 브랜치 푸시 감지 방식(GitHub Actions)으로 전면 교체

---

## Phase 43 — 동승자 선택 UI 및 사용성 개선 🧑‍🤝‍🧑

> 2026-04-25

### Changed
- 동승자 영역에서 직원이 많을 때 화면을 많이 차지하는 문제를 해결하기 위해 '접기/펼치기(아코디언)' 토글 기능 추가 (`PassengerSection.tsx`)
- 사용자의 동승자 접기/펼치기 상태를 브라우저 로컬 스토리지(`driveLog_passengerExpanded`)에 저장하여 재접속 시에도 상태 유지
- 동승자 목록이 닫혀 있을 때, 내가 선택한 직원들만 화면에 노출하여 쉽게 확인하고 취소할 수 있도록 UX 개선
- 동승자 목록이 닫혀 있을 때 '외부 인원' 텍스트를 간결한 '인원'으로 조건부 변경

## Phase 42 — 데이터 분석 확장 및 대시보드 차트 수정 📊

> 2026-04-18

### Added
- 대시보드 통계 계산 시 조직별(Org-Specific) 데이터 필터링/캐싱을 지원어 시스템 관리자가 다양한 시야로 분석할 수 있도록 인프라 보완 (`computeDashboardStats.ts`)
- 프론트엔드 대시보드의 글로벌 통계와 특정 조직별 그룹 통계를 스위칭할 수 있는 뷰 옵션 추가 (`ServiceDashboard.tsx`)

### Changed
- `useServiceDashboard.ts` 훅 구조체 개편 및 캐싱 데이터 불러오기 성능 고도화

### Fixed
- `ReportCharts.tsx`의 차트 내 툴팁에서 주행거리와 운행횟수 데이터를 표시하지 못하던 렌더링 누락 버그 패치

---

## Phase 41 — 데이터 검증 강화 및 쿼리/대시보드 성능 고도화 🚀

> 2026-04-17

### Added
- Zod 스키마 기반 데이터 유효성 검증 계층 도입 (`src/lib/firestore/reservations.ts`, `mutations.ts` 등)

### Changed
- **대시보드 렌더링 아키텍처 개편**: 탭 기반 네비게이션 도입으로 대시보드 초기 로드 가독성 향상
- **Firestore 쿼리 비용 최적화**: 클라이언트사이드 필터링 로직을 서버사이드 `where` 쿼리를 사용한 필터링으로 대체하여 N+1 이슈 및 대규모 읽기 과금 방지 (예약 목록, 애널리틱스)
- 불필요한 초기 번들 크기 축소를 위해 Recharts 모듈의 수동 청크(Manual Chunk) 및 지연 로딩 전략 보강

### Fixed
- "다크 모드" 사용자수 통계가 대시보드 차트에 0으로 표시되던 버그 패치 (Firestore Theme 데이터 집계 로직 정상화)
- 예약 일괄 취소 시 `Promise.all`로 발생하던 비원자성 이슈를 `writeBatch` 기반 패턴으로 수정하여 데이터 무결성 100% 보장
- 일부 차트 컴포넌트에 잔존하던 JSX 구문(Expression expected) Parsing 에러 전부 제거

---

## Phase 40 — 대규모 리팩토링 및 아키텍처 고도화 🏗️

> 2026-04-17

### Added
- `DriveLogForm` 리팩토링을 위한 레이아웃 컴포넌트 분할 (`DateSection`, `WaypointSection`, `PassengerSection`, `VehicleStatusSection`)
- 운행일지 비즈니스 로직 훅 추출 및 책임 분리 (`useDriveLogInitializer`, `useDriveLogSubmit`)
- 예약 캘린더 도메인 액션 모듈화 (`actions/cancelActions.ts`, `editActions.ts`, `submitActions.ts` 등)
- Tmap SDK 연동 레이어 모듈화 (`src/lib/tmap/` — core, routing, geocoding, deeplink 분리)
- 운행 데이터(DriveLogs) 처리 레이어 고도화 (`src/lib/firestore/driveLogs/` — mutations, queries, stats 분리)

### Changed
- **컴포넌트 SRP(단일 책임 원칙) 강화**: 1,000라인이 넘던 `DriveLogForm.tsx`를 목적지, 탑승자, 차량 상태 등 기능별 서브 컴포넌트로 분해하여 가독성 및 유지보수성 극대화
- **비즈니스 로직 캡슐화**: Firestore 접근 및 데이터 가공 로직을 UI 영역에서 완전히 분리하여 순수 함수 및 전용 훅으로 이전
- **Firestore 에러 핸들링 표준화**: 모든 데이터 접근 레이어에 `try-catch` 및 Sentry(`captureError`) 기반의 공통 에러 모니터링 패턴 적용
- **대시보드 성능 최적화**: 슈퍼관리자 대시보드의 차트 및 목록 20여 개 컴포넌트에 `React.memo` 및 `useMemo`를 적용하여 렌더링 성능 대폭 개선
- **타입 시스템 정교화**: 코드베이스 전반의 `any` 타입을 구체적인 인터페이스 및 제네릭으로 교체하여 `tsc` 빌드 시점의 오류 탐지 능력 강화

### Fixed
- 테스트 코드 안정화: `useTodayDashboard.test.ts` 등 주요 훅의 Mocking 불일치 및 비동기 `act()` 처리 오류 수정
- 대시보드 `useMemo` 종속성 배열 누락으로 인해 차트가 무한 재생성되던 성능 저하 버그 수정
- 조직 좌표 저장 시 리스트에 실시간으로 반영되지 않던 상태 업데이트 누락 수정 (DashboardOrgTable)

---

## Phase 39 — 로그인/안정성 개선 및 통계·사용성 보강 🔧

> 2026-04-17

### Added
- 대시보드 통계 화면 내 사용자의 다크 모드 데이터 집계용 테마(Theme) 사용 비율 차트 추가 (현재는 최고 관리자 대시보드로 통합)
- PWA(웹앱) 삼성 인터넷 브라우저 설치 가이드 FAQ 추가
- 최초 접속 웰컴 가이드의 종료(Dismiss) 여부 트래킹을 통한 앱 온보딩 채택률 통계 (시스템 관리자 대시보드)

### Changed
- 로그인 흐름 개선: Popup 인증에서 호환성이 뛰어난 Redirect 방식으로 롤백 (`src/lib/auth.ts`)
- 대시보드 버튼 위젯의 접근성 UI 롤백 (이전 레이아웃으로 변경)
- 테마(Theme) 사용 비율 통계를 기관 개별 관리자가 아닌 전체 트렌드를 파악하는 시스템 관리자(초고 관리자) 대시보드로 이전
- 개발자 문의 버튼 문구를 "AI에게 먼저 물어보기"로 변경

### Fixed
- Firebase 연동 시 `batteryStart`, `batteryEnd` 등의 undefined 프로퍼티가 그대로 전달되어 발생하는 `FirebaseError: Function addDoc() called with invalid data` 에러 수정
- 초대 코드가 담긴 딥링크 접속 시, 추출된 URL 파라미터를 뷰에 정상 반영하도록 수정

---

## Phase 38 — 코드 품질 강화 & 아키텍처 개선 🏗️

> 2026-03-22~23

### Changed
- `any` 타입 전면 정리: recharts formatter/콜백, 테스트 파일 mock, Firestore 데이터 등 → 구체 타입으로 치환
- ESLint `@typescript-eslint/no-explicit-any` 규칙 `warn`으로 활성화 + 잔존 경고 정리
- 상태 관리 Zustand 마이그레이션: `ThemeContext` → `useThemeStore`, `FontSizeContext` → `useFontSizeStore`
- CI에 E2E(Playwright) 테스트 통합 (`ci.yml` — Playwright 설치 + `npm run test:e2e`)
- `README.md` 갱신: Cloud Functions 목록, 테스트 수치, 프로젝트 구조 최신화
- `useReservationCalendar.ts` → `reservationUtils.ts` 순수 함수 추출 (`snapTo30`)
- `ServiceDashboard.tsx` 리팩토링: 차트 7개 서브 컴포넌트 분리 + `useServiceDashboard.ts` 훅 추출
- `FeedbackManagement.tsx` → `useFeedbackManagement.ts` 훅 추출

### Fixed
- TypeScript 컴파일 에러 전수 해결 (`any` 리팩토링 후속)
- `useEmployeeManager` 테스트 `window is not defined` 에러 수정 (firebase/analytics mock 추가)
- CI 파이프라인 안정화: E2E 테스트 CI 환경 분기 처리
- Sentry 모니터링 노이즈 개선: "동일한 운행 기록이 이미 존재합니다" 등 비즈니스 로직 예외 필터링 추가

---

## Phase 37 — 카카오 알림톡 연동 & 운영 개선 📱

> 2026-03-16

### Added
- 카카오 알림톡 발송 시스템 (`sendAlimtalk.ts` — 알리고 API + Cafe24 PHP 프록시 경유)
- 미활성 기관 일괄 알림톡 발송 (`sendBulkReminder` onCall, superAdmin 전용)
- 기관 관리 UI에 미활성 기관 일괄 알림톡 발송 버튼 (`OrgManagement.tsx`)

### Changed
- 의견 관리 사람별 그룹핑 정렬로 변경 (`FeedbackManagement.tsx` — 이메일 기준 그룹, 아코디언 UI, 이메일 복사)
- FAQ에 Google Workspace 캘린더 관리자 설정 가이드 추가 (`faqData.ts`)
- 릴리즈 노트에서 시스템 관리자 전용 항목 제거 (`releaseNotes.ts`)

### Fixed
- 알림톡 템플릿 불일치 오류 해결 (CRLF→LF, 버튼 URL 고정, `tpl_code` 추가)

---

## Phase 34 — 기능 추가 & 번들 최적화 & 운영 정비 🚀

> 2026-03-13

### Added
- FAQ 페이지 (`FAQPage.tsx` + `faqData.ts` — 대시보드 우측 배치)
- 업데이트 소식 페이지 (`ReleaseNotesPage.tsx` + `releaseNotes.ts`)
- 주유 기록 관리 (`FuelLogManager.tsx`, `FuelLogTab.tsx`, `useFuelLog.ts`, `useFuelLogAdmin.ts`, `fuelLogs.ts`, `fuelLogPdfExport.ts`, `fuelLog.ts`)
- 히트맵 그리드 공통 컴포넌트 (`HeatmapGrid.tsx`)
- ConfirmContext 전역 확인 모달 (`ConfirmContext.tsx`)
- 차량 유틸리티 분리 (`vehicleUtils.ts`)
- 정비 기록 PDF 출력 (`maintenancePdfExport.ts`)
- Cloud Functions: `joinOrganization.ts`, `migrateCustomClaims.ts`, `rateLimit.ts`

### Changed
- JS 번들 최적화: 2276KB → 예산 이내로 감소 (코드 스플리팅, 미사용 라이브러리 정리)
- ESLint 정리 및 코딩 컨벤션 업데이트
- Cloud Functions 규칙 및 스킬 문서 갱신

### Removed
- 푸시 알림 기능 일부 제거 (운행 시작 알림 취소)

### Fixed
- Google 로그인 안정성 개선
- Sentry 에러 필터링 (ServiceWorker `InvalidStateError`, `SyntaxError: Unexpected end of input`)

---

## Phase 33 — 운영 품질 강화 & 서비스 성장 기반 📊

> 2026-03-12

### Changed
- CI/CD 워크플로우 수정: TypeScript 전환 후 잔존 `.js` 경로 → `.ts` 수정 (`ci.yml`)

### Fixed
- npm 보안 취약점 조치: `minimatch` High 7개 → `overrides`로 `>=9.0.5` 강제
- Firestore 인덱스 정리: 전자결재 제거 후 불필요한 `approvalStatus` 복합 인덱스 삭제 (17→16개)
- 테스트 안정화: 4개 테스트 파일에 `useConfirm` mock 누락 수정
- 31개 파일, 243개 테스트 전체 통과 ✅

---

## Phase 32 — 기능 개선 & 버그 수정 🔧

> 2026-03-11~12

### Added
- 정비 기록 Excel/PDF 다운로드 (`excelExport.ts`, `maintenancePdfExport.ts`)
- 정비 기록 검색/필터 (텍스트 검색, 차량, 유형, 기간) (`useMaintenanceLog.ts`)
- 히트맵 공유 컴포넌트 (`HeatmapGrid.tsx` — 요일×시간대 운행 밀도)
- `window.confirm` → 커스텀 모달 전면 교체 (`ConfirmContext.tsx` + `useConfirm` 훅)
- `vehicleUtils.ts` — 정비 차단 상태 판별 유틸리티 분리

### Changed
- 다일 예약 UI 정밀 조정 — 시작/종료 날짜 수직 정렬, N일간 인라인 표시

### Fixed
- 기관 로그인 문제: 삭제→재생성 기관의 기존 직원 로그인 불가 수정 (`useAuth.tsx`)
- 출발Km 덮어쓰기: 편집 모드에서 출발Km가 최신 값으로 덮어쓰이는 버그 수정
- Firestore 권한: 정비 기록(`maintenanceRecords`) 접근 규칙 추가
- Sentry: IndexedDB `Database deleted by request` iOS Safari 에러 필터링

---

## Phase 31 — 서비스 안정성 강화 & 운영 개선 🏥

> 2026-03-11

### Added
- Cloud Functions Rate Limiting (`rateLimit.ts` — Firestore 기반 uid/IP별 요청 제한)
- 신규 승인 기관 타임라인 차트 (`ServiceDashboard.tsx`)
- `rateLimit.test.ts` 테스트 2개

### Changed
- 페이지네이션 최적화: 클라이언트 필터 → 서버사이드 Firestore `where` 전환
- PDF 정렬: 날짜 1차 + 출발 시간 2차 오름차순
- PDF 헤더: "동반인원" → "탑승인원" 용어 통일
- 예약 폼 닫을 때 입력 필드 자동 리셋

### Fixed
- 새 탭 로그아웃: `setPersistence` fire-and-forget → `authReady` Promise 패턴 전환
- 직원 목록 `orgId` 관련 데이터 표시 오류

---

## Phase 30 — 운영 개선 & 사용성 강화 & 컨텐츠 갱신 🛠️

> 2026-03-09

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

## Phase 29 — 직원 목록 통합 뷰 👥

> 2026-03-07

### Changed
- 활성 직원 + 사전등록(가입 대기) + 비활성 직원을 단일 `unifiedList`로 통합 (`useEmployeeManager.ts`)
- `EmployeeManager.tsx` — 기존 3개 별도 섹션을 1개 통합 목록으로 전면 재작성
- 통합 검색: 모든 상태(활성/대기/비활성)에 검색 통합 적용
- 헤더 통계: `총 N명 · 활성 N명 · 가입 대기 N명 · 비활성 N명`

---

## Phase 28 — TypeScript 전면 전환 🔧

> 2026-03-07

### Changed
- 프론트엔드: 모든 `.jsx`→`.tsx`, `.js`→`.ts` 전환 (컴포넌트 62개 + 훅 21개 + 라이브러리 17개)
- Cloud Functions: `functions/src/` TypeScript ESM 전환, `tsconfig.json` 추가
- E2E 테스트: `.spec.js`→`.spec.ts` 전환 (8개 파일)
- 스크립트: `.js`→`.ts` 전환 (7개 파일), `tsx`로 실행
- 단위 테스트: `.test.js`→`.test.ts`/`.test.tsx` 전환 (35개 파일)

### Added
- 신규 훅 테스트 11개 + 라이브러리 테스트 4개 추가
- `TYPESCRIPT_MIGRATION.md` 전환 가이드 문서

---

## Phase 27 — 용어 통일 & UI 개선 🏷️

> 2026-03-07

### Changed
- "슈퍼 관리자" → "시스템 관리자" UI 텍스트 일괄 변경
- 예약 취소 로직 → `CancelReservationHandler.tsx` 별도 컴포넌트 분리

### Added
- `scripts/check-feedbacks.ts` 피드백 데이터 점검 스크립트

---

## Phase 26 — Soft Delete 확장 & 사용자 관리 강화 🛡️

> 2026-03-07

### Added
- 사용자 Soft Delete: 기관 삭제 시 Firebase Auth 비활성화 + Firestore disabled 플래그 (문서 삭제→비활성화 전환)
- `disableUser.ts` — 시스템 관리자 전용, Auth 비활성화 + Firestore 플래그
- `restoreUser.ts` — 비활성화된 사용자 복원 (Auth 재활성화 + Firestore 문서 복구)
- `OrgCard.tsx` — 사용자 복원 UI (이메일+이름 입력→복원)

### Changed
- Firestore 규칙: 직원 추가 시 disabled 사용자 권한 검증 강화

---

## Phase 25 — 기관 정보 권한 분리 🔒

> 2026-03-05

### Changed
- 기관명·주소: 모든 사용자 `disabled`, 슈퍼관리자만 `OrgCard.tsx`에서 인라인 편집 가능
- 설정 페이지: 기관명→주소→이메일→전화번호 순서 재배치 (disabled 필드 상단 묶음)

---

## Phase 24 — 다중 목적지 & 접근성 & 품질 강화 🎯

> 2026-03-04

### Added
- 다중 목적지 경로 탐색 (`tmap.ts` — `parseDestinations`, `getMultiRoute`, `getTmapDeeplink`)
- 글꼴 크기 조절 기능 (`FontSizeContext.tsx` — 소/중/대 3단계, `MorePage.tsx` 설정 UI)
- Cloud Functions 테스트 4개 (`functions/__tests__/` — 예약 생성/헬퍼/알림/전송)
- React 훅 테스트 3개 (`useDriveLogForm`, `useReservationCalendar`, `useTodayDashboard`)
- 예약 화면 즐겨찾기 등록 버튼

### Changed
- OCR 모델 업그레이드: `gemini-3.1-flash-lite` (`ocrDashboard.ts`, `ocrDocument.ts`)
- 목적지 입력 placeholder 축약 (모바일 가독성 향상)
- Firestore 보안 규칙 정비 (즐겨찾기/예약 권한 검증 강화)
- Firestore 복합 인덱스 추가 (신규 쿼리 패턴)

### Fixed
- 달력 2~3일째 행 높이 불일치 스타일 버그 (`CalendarGrid.tsx`)
- IndexedDB 오류 시 graceful fallback 처리 (`firebase.ts`)

---

## Phase 23 — 운영 버그 수정 & 기능 개선 🔧

> 2026-03-03

### Added
- `cleanupDuplicateLogs.ts` — 중복 운행 기록 탐지/정리 HTTP Cloud Function
- OCR 오류 신고: 인식 실패 시 이미지+결과를 피드백 시스템에 자동 전송 (`useDriveLogOcr.ts`)
- `OcrTestPage.tsx` — 슈퍼관리자 전용 OCR 테스트 페이지

### Fixed
- E2E 테스트 UI 동기화: 경로/텍스트 셀렉터 업데이트, 20개 실패→39개 전체 통과
- Firestore 복합 인덱스 추가 (신규 쿼리 패턴)
- 배포 워크플로우: `fnm env` 초기화 + Node 22 전환 안정화

---

## Phase 22 — 설정 페이지 재설계 & UI 통일 🎨

> 2026-03-02

### Changed
- 설정 페이지 섹션 재배치: 기관 정보→공휴일→고유번호→계정→알림→가이드→앱 정보
- 로그아웃 버튼: 빨간색 독립 버튼으로 시각적 분리
- 페이지 타이틀: 이모지 제거, 클린 스타일 통일
- 공휴일 관리: 3열 그리드 레이아웃 + 연도 선택 추가 (`HolidayManager.tsx`)
- 타임라인 범례 1줄 축약
- 달력 다크모드 공휴일 표시 수정 (`CalendarGrid.tsx`)

---

## Phase 21 — Firestore 보안 수정 & 동시 운행 제한 & UI 개선 🔧

> 2026-02-28

### Added
- 동시 운행 시작 제한: 운행 중이면 다른 예약의 시작/티맵 버튼 비활성화 + 안내

### Changed
- 예약 없는 운행: 운행 중일 때 카드 숨김, "바로 출발"→"바로 운행" 용어 통일
- 알림 설정: 사이드바 하단→설정 페이지 안으로 이동 (glass-card 스타일)
- 내 기록: 날짜 축약 포맷 `M/D(요일)` + 시작~마침 시각 표시 (`dateUtils.ts`)

### Fixed
- Firestore 권한: 직원이 `vehicles.currentKm` 업데이트 가능하도록 규칙 추가
- 다크모드 버튼 스타일: 티맵/운행 시작/바로 운행 `dark:` 변형 추가

---

## Phase 20 — 리팩토링 & 테스트 & 접근성 🔨

> 2026-02-27

### Phase 20-A: 대형 컴포넌트 분리

- `OrgApplicationPage` → `useOrgApplication.ts` 훅 추출
- `TodayDashboard` → `WelcomeGuide` + `ReservationCard` + `WeekReservationList` 3개 서브 컴포넌트
- `UserManual` → `manualSections.ts` 데이터 추출 (321줄→127줄)

### Phase 20-B: 테스트 커버리지 확대

- 순수 함수/훅 테스트 42개 추가 (74→116개, +57%)
- `timelineUtils`, `pdfStyles`, `manualSections`, `useOrgApplication` 테스트

### Phase 20-C: Cloud Functions 개선

- `helpers.ts` — 구조화 로깅(`log()`) + HTTP/범용 에러 래퍼(`wrapHttps`, `wrapHandler`)
- `holidayProxy.ts`, `tmapProxy.ts` — `wrapHttps` 적용

### Phase 20-D: 접근성(a11y) 강화

- `ConfirmModal` / `UserManual` — `role="dialog"`, `aria-modal`, `aria-labelledby` 추가
- `EmployeeLayout` — 하단 nav `aria-label` 추가

### Phase 20-E: Firestore 인덱싱 확인

- 기존 13개 복합 인덱스가 모든 쿼리 패턴을 커버 → 추가 불필요

### Phase 20-F: 모니터링 강화

- `sentry.ts` — `web-vitals`로 CLS/FCP/LCP/TTFB/INP 5개 지표 수집 → Sentry 전송

---

## Phase 19 — 보안 강화 & E2E 테스트 & 리팩토링 ✅

> 2026-02-27

### Added
- E2E 반응형 테스트 (`responsive.spec.ts` — 모바일/태블릿 뷰포트)
- E2E 접근성 테스트 (`accessibility.spec.ts` — h1, img alt, 버튼 라벨)
- E2E 성능 테스트 (`performance.spec.ts` — 초기 로드, 메타 태그, SW 등록)

### Changed
- Firestore Rules: `users` create 필드 검증, `driveLogs`/`reservations` update 소유자+관리자 제한
- `VehicleTimelineBar` → `timelineUtils.ts` + `useTimelineDrag.ts` 분리
- `pdfExport` → `pdfStyles.ts` 분리 (415줄→210줄)

---

## Phase 18 — 번들 최적화 & UX 개선 ✅

> 2026-02-27

### Changed
- Firebase 모듈 분할: `firebase/messaging` 동적 import, `manualChunks`로 auth/db/messaging 3분할
- Sentry 지연 로딩: 동적 `import()`로 초기 번들에서 분리 (78kB 별도 청크)
- Auth 페이지 Lazy Loading: 인증 7개 페이지 `lazyWithRetry` 코드 스플리팅
- index 청크 342kB → 204kB (**40% 감소**)

---

## Phase 17 — UX 정밀 개선 및 버그 수정 🎯

> 2026-02-27

### Added
- `ConfirmModal.tsx` — 브라우저 `prompt()`/`confirm()` 대체 모달 (텍스트 입력, 위험 동작 강조)

### Changed
- Tmap carType 매핑: 경형차 톨비 50% 할인 정확 반영
- 예약 타임라인: 빈 시간대 시각화, 아코디언 클릭 토글 방식 전환
- 과거 시간 예약 방지 (오늘: 현재 시각 기준, 과거 날짜: 전체 차단)
- 다크 모드 탭 스타일 누락 수정 (기관 신청/관리 페이지)

---

## Phase 16 — 기능 정비 및 UX 고도화 🔨

> 2026-02-27

### Removed
- 전자결재 시스템 전면 제거 (`ApprovalList.jsx` 삭제, 관련 라우트/코드 정리)

### Added
- 예약 없이 바로 운행 시작 (`QuickDriveStart.tsx` + `useQuickDriveStart.ts`)
- 서버사이드 예약 중복 방지 (`createReservationSafe.ts` — Firestore 트랜잭션)
- 차량 퇴역/복귀 기능 (`vehicles.status` 필드, `VehicleManager.tsx` 액션)
- 정비 중 차량 사용 차단 (`MaintenanceLog.tsx` — `blockVehicle`/`maintenanceEndDate`)
- 차량 타임라인 바 (`VehicleTimelineBar.tsx` — 예약 간 빈 시간대 시각화)
- 기관 신청 알림 (`notifyNewApplication.ts` — 슈퍼관리자 FCM 푸시)
- 의견 관리 실시간 배지 (슈퍼관리자 사이드바)
- PWA 설치 안내 (`IOSInstallPrompt.tsx`, `InstallPrompt.tsx`)
- 인앱 브라우저 감지 + 외부 열기 유도 (`inAppBrowser.ts`)
- 안드로이드 뒤로가기 버튼 처리 (`useBackButton.ts`)
- 라이트 모드 강제 적용 훅 (`useForceLightMode.ts`)
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
- `scripts/security-audit.ts` — npm 보안 감사 리포트
- `scripts/check-functions-health.ts` — Cloud Functions 에러 빈도 분석

---

## Phase 13 — 신규 기능 추가 🌟

### Added
- Google Calendar 역동기화 (`syncCalendarToApp` 10분 주기)
- 예약 출처 뱃지 ("📅 캘린더") `ReservationSidePanel.tsx`
- 예약 취소/변경 시 앱 내 알림 + FCM 푸시 자동 전송
- 관리자 공지 기능 (`AdminNotice.tsx` + `sendAdminNotice.ts`)
- `NotificationBell` type별 아이콘 (✅❌🚫✏️📢ℹ️)

---

## Phase 12 — 운영 품질 강화 📈

### Added
- PWA 스크린샷 자동 생성 (`scripts/generate-screenshots.ts`, Playwright + sharp)
- E2E 테스트 확대: `landing.spec.ts`(8개), `terms-privacy.spec.ts`(5개)
- 번들 크기 모니터링 (`scripts/check-bundle-size.ts`, JS 600KB / CSS 60KB 예산)

### Changed
- Lighthouse 접근성 개선: `index.html` preconnect 힌트, aria 속성 보강

---

## Phase 11 — PWA 안전성 개선 및 보안 강화 🔧

### Changed
- PWA registerType `autoUpdate` → `prompt` 전환
- FCM SW 빌드 시 `.env` 자동 주입 (`generate-sw-config.ts`)
- CSP 인라인 스크립트 → 외부 `sw-purge.js`로 분리
- Firebase API Workbox 캐시 제거 (Firestore SDK 자체 캐시와 중복)

### Added
- PNG 앱 아이콘 생성 (`icon-192.png`, `icon-512.png`)
- IndexedDB 선별 삭제 (`sw-purge.js`)
- Manifest 스크린샷 경로 등록

---

## Phase 10 — UX/안정성 패치 🔧

> 2026-02-24

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
- 전자결재 워크플로우 (`ApprovalList.tsx`)
- 고도화 분석 대시보드 (`AnalyticsDashboard.tsx` — 트렌드/비용 최적화)
- 다크 모드 (`ThemeContext` + 개인 설정 Firestore 저장)
- 데이터 아카이빙 (`archiveDriveLogs.ts` — 3년+ 기록 GCS 이동)

### Changed
- 온보딩 위자드 + 웰컴 가이드 + Empty State 개선

---

## Phase 8 — 서비스 운영 기반 🏢

### Added
- Firestore 자동 백업 (`backupFirestore.ts` — 매일 03:00 KST)
- 기관 soft delete + 30일 복구 (`autoPurgeOrgs.ts`)
- 삭제 기관 → 소속 사용자 실시간 로그인 차단
- 슈퍼관리자 서비스 대시보드 (`ServiceDashboard.tsx`)
- 이용약관 + 개인정보 처리방침 (`/terms`, `/privacy`)
- Firestore 오프라인 캐시 (`persistentLocalCache`)
- PWA 자동 업데이트 배너 (`UpdatePrompt.tsx`)
- AI OCR Fallback UX ("수동 입력하기" 버튼)
- 대용량 출력 방어 (최대 3개월 제한)

---

## Phase 7 — 안정성 강화 및 테스트 🔒

### Added
- Sentry 에러 모니터링 연동
- FCM 푸시 알림 완성 (Service Worker + 토큰 관리)
- 단위 테스트 11개 (Vitest), E2E 테스트 (Playwright)
- 예약 푸시 알림 (`reservationReminder.ts` — 5분 주기)
- 일지 미작성 푸시 알림

### Changed
- PWA manifest 보강 (maskable 아이콘, id)
- Firestore 보안 규칙 확장 (feedbacks/users/favorites)

---

## Phase 6.5 — UX 개선 및 안정성 🛡️

### Added
- Skeleton UI, 에러 바운더리, 오프라인 배너
- 토스트 알림 (`useToast.tsx` — 성공/에러/경고, 중복 방지)
- 피드백 시스템 (사용자 제출 + 슈퍼관리자 관리)
- 앱 내 사용자 매뉴얼 (`UserManual.tsx`)
- Sentry 연동 + FCM 알림 훅 + 알림 전송 Function
- 공휴일 API 프록시 (`holidayProxy.ts`) + 자동 동기화

### Fixed
- CSV 다운로드 날짜 컬럼 누락

---

## Phase 6 — 출력 및 부가 기능 📊

### Added
- 운행일지 PDF 출력 (공식 양식 A4 가로, 결재란, 자동 페이지 분할)
- 운행일지 Excel 다운로드 (기간 필터)
- 결재란 커스터마이징 (`Settings.tsx`)
- 월별 통계 대시보드 (`MonthlyReport.tsx` — 차트 + 추이)
- 예약 임박/미작성 알림 (클라이언트)
- 차량 정비 기록 CRUD (`MaintenanceLog.tsx`)

---

## Phase 5 — 차량 예약 시스템 📅

### Added
- 달력 UI 예약 시스템 (`ReservationCalendar.tsx`)
- 예약 CRUD (생성/조회/수정/취소, 실시간 구독)
- 시간대 충돌 방지
- 운행 시작 워크플로우 (예약 → in_progress → 일지 작성)
- 오늘 대시보드 (`TodayDashboard.tsx`)
- 구글 캘린더 연동 (`calendarSync.ts`)

---

## Phase 4 — AI & 외부 연동 🤖

### Added
- 계기판 OCR (`ocrDashboard.ts` — Gemini Vision → Km/배터리%)
- 고유번호증 AI 분석 + 자동 승인 (`autoVerifyDocument.ts`)
- 서버사이드 이메일 발송 (`@emailjs/nodejs`)
- 티맵 딥링크 + 경로 탐색 (`tmap.ts`, `tmapProxy.ts`)

---

## Phase 3 — 운행일지 핵심 기능 📝

### Added
- 운행일지 작성 폼 (`DriveLogForm.tsx`)
- 출발Km 자동 입력 + 도착Km 트랜잭션 업데이트
- 내 기록 목록/수정 (`MyRecords.tsx`)
- 관리자 운행일지 조회/검색/수정 (`DriveLogList.tsx`)
- 사용목적 프리셋, 예약→운행일지 연동
- 목적지 즐겨찾기, 동승자 빠른 선택, 이어서 기록

---

## Phase 2 — 기관 관리 기능 👥

### Added
- 직원 관리 CRUD (`EmployeeManager.tsx`)
- 초대 코드 시스템 (6자리 코드 생성/재발급)
- 차량 관리 CRUD (`VehicleManager.tsx`)
- 기관관리자/슈퍼관리자 레이아웃
- 기관 관리 + 기관 설정 (결재란, 공휴일)

---

## Phase 1 — 프로젝트 기반 구축 🏗️

### Added
- Vite + React 프로젝트 생성
- Firebase 연동 (Auth, Firestore, Hosting, Storage)
- 구글 로그인 (`LoginPage.tsx`)
- 역할 기반 라우팅 (superAdmin / admin / employee)
- 기관 신청 + 승인 시스템
- 앱 내 알림 (`NotificationBell.tsx`)
- Firestore 보안 규칙
- 공휴일 API 연동
