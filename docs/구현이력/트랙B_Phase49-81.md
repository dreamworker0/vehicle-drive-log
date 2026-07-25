# 트랙 B — 운영 고도화 로그 (Phase 49~81)

> 2026-04-15 ~ 2026-07-03. 아키텍처 리팩토링·보안 감사·집계 파이프라인 구축 구간.
>
> 전체 목차와 다른 구간은 [구현이력.md](../구현이력.md) 참고.

---

### Phase 49: 차량운행일지 종합 고도화 (진행 중) 🚀

> 2026-04-15, 코드 유지보수성, E2E 검증, 다크모드 UX 접근성 확보 및 신규 알림/리포팅 기능 구체화를 위한 고도화 진행

| 영역 | 항목 | 내용 | 상태 |
|------|------|------|------|
| **Phase 1<br>(코드 품질)** | 의존성 점검 및 E2E 보강 | 불필요 리소스 정리(`depcheck`) 및 Playwright E2E 핵심 시나리오(예약, 일지 작성) 스켈레톤 작성 | ✅ 완료 |
| **Phase 2<br>(UX/알람)** | 다크 모드 접근성 | 대시보드 차트, 모달 컴포넌트 등의 명도비 점검 및 누락된 `dark:` 폰트/배경색 일괄 수정 | 🔄 진행 중 |
| | **(논의) 차량 예약 관리자 승인제 추가** | 예약 시 무조건 자동 승인(`reserved`)을 대기(`pending`)로 변경하고 관리자 수동 승인/반려 시 알림톡 발송 기능 도입 필요성 여부 등 추가 논의 대기 | 🚧 보류 중 |
| **Phase 3<br>(리포팅/분석)** | 통계 리포트 다운로드 강화 | 부서별 차량 이용 비율 월별 리포트(`Add Excel Export`) 등 고급 관리자용 분석 지표 개발 | ⏳ 대기 |

---

### Phase 50: 거대 모놀리식 아키텍처 리팩토링 및 성능/렌더링 최적화 🚀 ✅

> 2026-04-17, 거대 컴포넌트·훅의 모듈화 분리, Recharts 번들 최적화, 렌더링(useMemo/useCallback) 최소화 및 N+1 쿼리 최적화 등 프론트엔드/백엔드 최적화 수행.

| 항목 | 내용 |
|------|------|
| **거대 컴포넌트 분리** | `DriveLogForm.tsx`, `OrgCard.tsx`, `MaintenanceLog.tsx`, `DriveLogList.tsx`, `ReservationSidePanel.tsx`를 Date, Waypoint, Passenger, VehicleStatus 등의 작고 명확한 서브 컴포넌트로 분리하여 단일 책임 원칙(SRP) 준수. |
| **거대 훅 모듈화** | `useReservationPattern`, `useTodayDashboard`, `useAnalytics` 등 거대 훅 내부의 복잡한 비즈니스 로직(순수 함수)을 `utils/` 폴더로 추출하여 IO 처리 로직과 분리 및 테스트 용이성 강화. |
| **번들 최적화(Recharts)**| `vite.config.ts` 및 차트 컴포넌트에서 지연 로딩(Lazy Loading)을 통해 Recharts 라이브러리를 초기 번들에서 분리하여 초기 로딩(FCP) 성능 개선. |
| **렌더링 최적화** | ServiceDashboard, OrgCard 계열 등 잦은 리렌더링이 발생하는 컴포넌트들에 `React.memo`, `useMemo`, `useCallback`을 적극 적용하여 React 렌더링 오버헤드 최소화. |
| **Firestore N+1 쿼리 등 개선**| `useAnalytics.ts`의 N+1 쿼리 문제를 해결. 전체 Firestore 읽기 작업(트랜잭션/배치 포함)에 일관성 있는 `try-catch` 기반 에러 핸들링 도입. |
| **에러 해결 및 타입 검증**| `App.tsx`, `useRef` 참조 오류 등 런타임 에러 긴급 패치와 테스트 Mocking 파일 내 `any` 캐스팅 최소화를 통한 타입 안정화 확보. |

---

### Phase 51: Firebase App Check 제거 및 의존성/보안 점검 🔐 ✅

> 2026-05-01, Firebase 인증 오류 해결을 위한 App Check 제거, 의존성 취약점(audit) 점검, Firestore Rate Limit 최적화(TTL 적용).

| 항목 | 내용 |
|------|------|
| **Firebase App Check 제거** | `src/lib/firebase.ts` — App Check 초기화 로직 및 `reCAPTCHA` 관련 의존성 완전 제거. Firebase 콘솔 설정을 '모니터링 모드'로 변경하여 인증 실패(500 에러) 문제 해결 |
| **의존성 취약점 점검 (Audit)** | `/audit` 워크플로우 실행 — `npm audit fix`를 통해 프론트엔드 및 백엔드의 호환 가능한 보안 취약점 패치 완료 |
| **Firestore 보안 최적화** | `_rateLimits` 컬렉션 — `expiresAt` 필드 기반의 **TTL(Time-To-Live)** 정책을 GCP 콘솔에서 활성화하여 만료 문서 자동 삭제 적용 |
| **잔여 보안 모니터링** | `serialize-javascript` 등 런타임 영향이 적은 빌드 도구 취약점은 유지. `firebase-admin` 등 GCP 관련 의존성은 안정성을 위해 업데이트 보류 및 추적 관찰 |
| **향후 유지보수 로드맵** | GCP API 키 사용 제한(Web/Localhost), Firebase Auth 이메일 열거 보호 활성화, 정기 Audit 점검 및 CSP 헤더 추가 검토 예정 |

---

### Phase 52: 시스템 아키텍처 개선 및 동시성/멱등성 강화 🚀 ✅

> 2026-05-08, 데이터 무결성 강화를 위한 사이드 이펙트 서버사이드 마이그레이션, 오프라인 멱등성 확보 및 Sentry 노이즈 최적화.

| 항목 | 내용 |
|------|------|
| **사이드 이펙트 Cloud Functions 마이그레이션** | 주행거리 갱신 및 로그 동기화 로직을 클라이언트 뮤테이션에서 Firestore `onCreate` 트리거(`functions/src/logs/syncDriveLogSideEffects.ts`)로 이전하여 데이터 무결성 확보 |
| **오프라인 멱등성 보장** | 오프라인 큐 사용 시 클라이언트 측에서 미리 문서 ID를 생성하여 PWA 오프라인 큐 재시도 시 발생하는 데이터 중복 및 유실 방지 |
| **동시성 처리 (Race Condition 방어)** | 하이패스 잔액 동기화 및 누적 주행거리 갱신 시 `last-write-wins` 방식의 절대값 덮어쓰기 로직을 Firebase Atomic `increment` 연산으로 대체하여 데이터 무결성 보장 |
| **운행 주행거리 보정 프로세스 개선** | 출발 주행거리 수정 시 백그라운드 자동 보정 대신 `ConfirmModal`을 통한 사용자 명시적 승인 절차 도입으로 데이터 정합성과 투명성 강화 |
| **Sentry 노이즈 필터링 정책 고도화** | `AppCheck: Requests throttled`, `Fetch failed to connect to a network` 등 인프라 레벨의 무해한 네트워크 에러를 Sentry 필터 규칙에 추가하여 알람 피로도 완화 |
| **타입 안정성 고도화** | 뮤테이션 로직(`submitDriveLog.ts`) 내 불필요한 `as Record<string, unknown>` 단언을 제거하고 `createDriveLog`, `updateDriveLog`의 명시적 리턴 타입 재사용 패턴 확립 |

---

### Phase 53: 로그인/인증 안정성 패치 🛡️ ✅

> 2026-05-15, 로그인 시 토큰 Claims 갱신 무한 로딩 버그 수정.

| 항목 | 내용 |
|------|------|
| **인증 안정화** | `useAuth.tsx` — 로그인 시 토큰 Claims 갱신 과정에서 발생할 수 있는 무한 로딩 버그 수정 (백그라운드 fire-and-forget 갱신 처리 적용) |

---

### Phase 54: 성능 최적화 및 타입 안정성 패치 🚀 ✅

> 2026-05-15, 대시보드 조회 및 렌더링 최적화, 타입 통합, 모듈 분리 등 대대적인 코드 리팩토링 및 성능 개선.

| 항목 | 내용 |
|------|------|
| **대시보드 안전장치** | `organizations.ts` — 시스템 관리자의 기관 목록 조회 시 비정상적인 풀스캔 방지를 위한 `limit(100)` 추가 |
| **렌더링 최적화** | `useDriveLogList.ts` — 운행일지 리스트 필터링 및 합계 계산 로직에 `useMemo`를 도입하여 불필요한 리렌더링 방지 |
| **타입 시스템 정비** | 흩어져 있던 `DriveLogEntry` 인터페이스 중복을 제거하고 `src/types/driveLog.ts`로 단일 통합 분리 |
| **초기 번들 최적화** | 정적 데이터(릴리즈 노트, 매뉴얼)를 JSON으로 분리하고 Lazy Loading 적용. 이미지 라이브러리 청크 분할 (메인 번들 축소) |
| **백엔드 모듈 분할** | 거대 모놀리식 모듈인 `computeDashboardStats`, `autoVerifyDocument`를 순수 함수와 헬퍼 단위(`verifyHelpers`)로 분리하여 유지보수성 향상 |
| **프론트 로직 분리** | `useVehicleManager` 훅 내의 차량 모델 정적 데이터 및 판별 로직을 `vehicleModelData.ts` 유틸리티로 별도 분리 |

---

### Phase 55: App Check 재도입 & Sentry 최적화 & 운영 안정화 🔐 ✅

> 2026-05-17, Firebase App Check reCAPTCHA v3 재도입, Sentry 트레이스 샘플링·비즈니스 에러 필터링 최적화, 프론트/백엔드 아키텍처 리팩토링, 기관 쿼리 확장, CI/CD 파이프라인 수정.

| 항목 | 내용 |
|------|------|
| **Firebase App Check 재도입** | `firebase.ts` — Phase 51에서 제거했던 App Check를 **reCAPTCHA v3** 기반으로 재도입. `ReCaptchaV3Provider` + `isTokenAutoRefreshEnabled` 적용. 개발 환경은 디버그 토큰 사용. SDK 내부 console.warn 노이즈 필터링 로직 추가. `onTokenChanged` 에러 핸들러에 60초 윈도우 dedup 적용 |
| **Sentry 트레이스 샘플링 최적화** | `sentry.ts` — `tracesSampleRate` 30%로 감소하여 성능 모니터링 오버헤드 절감 |
| **Sentry 비즈니스 에러 필터링** | 주행거리 유효성 검증 실패 등 정상적인 비즈니스 로직 에러를 Sentry 전송에서 제외하여 알람 피로도 완화 |
| **Sentry 브라우저 확장 에러 무시** | `autocomplete-textarea` 등 외부 확장 프로그램이 주입한 스크립트 에러 필터링 |
| **기관 쿼리 limit 확장** | `organizations.ts` — 시스템 관리자 기관 목록 조회 `limit(100)` → `limit(500)` 확장 (170개+ 기관 전체 표시) |
| **프론트엔드 아키텍처 리팩토링** | `autoVerifyDocument.ts` → `verifyHelpers.ts`로 순수 함수 분리. `computeDashboardStats` → `dashboardHelpers.ts` + `dashboardSections.ts`로 분할. `vehicleModelData.ts` 유틸리티 신규 분리 |
| **정적 데이터 번들 최적화** | 릴리즈 노트·사용자 매뉴얼을 `public/data/*.json`으로 분리하고 런타임 Lazy Loading 적용. 메인 번들 크기 추가 절감 |
| **운행일지 내보내기 제한** | 운행일지 Excel 내보내기 시 5,000건 상한 제한 추가 (대용량 처리 방어) |
| **GitHub Actions CI/CD 수정** | `deploy.yml` — `.npmrc`에 `legacy-peer-deps` 자동 설정. `permissions: checks: write` 추가로 Firebase Hosting 배포 시 GitHub Checks API 권한 오류 해결 |
| **E2E 테스트 안정화** | `org-application.spec.ts` — 기관 신청 테스트 타임아웃 오류 수정 (앱 타이틀 매칭 및 대기 시간 조정) |
| **환경변수 변경** | `.env` — `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` → `VITE_RECAPTCHA_SITE_KEY`로 변경 (reCAPTCHA Enterprise → v3 전환) |

---

### Phase 56: iOS Safari 호환성 & Sentry 에러 억제 🛠️ ✅

> 2026-05-21, iOS Safari 환경의 IndexedDB 삭제 관련 브라우저 버그(UnknownError: Failed to delete record from object store) 해결을 위한 Sentry 무시 처리 및 Firebase 런타임 안전장치 보강.

| 항목 | 내용 |
|------|------|
| **Sentry 노이즈 무시** | `sentry.ts` — `ignoreErrors`에 `/Failed to delete record from object store/` 정규식 무시 필터 추가 (iOS Safari IndexedDB 내부 버그 오탐 차단) |
| **Firebase 에러 전파 억제** | `firebase.ts` — `isFirestorePersistenceError` 내에 `'Failed to delete record from object store'` 조건 추가하여 전역 에러 전파 차단 및 콘솔 경고 처리로 우회 |
| **정적 검사 및 빌드 검증** | ESLint 린트 검사, tsc 타입 체크, Vite 프로덕션 빌드 파이프라인을 통과시켜 소스코드 결합 안정성 입증 |

---

### Phase 57: 운행일지 데이터 구조 확장 & Sentry 필터 고도화 & Cloud Functions 야간 유휴 절전 최적화 🚀 ✅

> 2026-05-22, driveLog 수동 보정 필드 추가 등 데이터 스키마 확장, N+1 방어용 Firestore 조회 성능 최적화, iOS Safari IndexedDB Sentry 노이즈 억제 안정화, Cloud Functions 야간 절전 적용으로 과금 대폭 절감 및 로컬 App Check 디버그 연동 완료.

| 항목 | 내용 |
|------|------|
| **운행일지 스키마 및 타입 확장** | `driveLog` 데이터 규격에 수동 보정 여부(`isManuallyCorrected`) 및 원본 출발 누적 거리(`originalStartKm`) 필드 추가. `src/schemas/driveLog.ts` 및 `src/types/driveLog.ts` 확장 완료 |
| **Firestore 조회 성능 최적화 (N+1 방어)** | 이전/이후 운행 기록의 일괄 조회를 위해 `getLastVehicleDriveLog`, `getAdjacentDriveLogs` 헬퍼 함수를 `src/lib/firestore/driveLogs.ts`에 도입하여 N+1 쿼리 및 DB 부하 절감 |
| **Sentry 및 런타임 예외 필터링 고도화** | iOS Safari IndexedDB 내부 버그 예외인 `Failed to delete record from object store`에 대해 `sentry.ts` 필터 규칙 보강 및 브라우저 런타임 내 에러 전파 억제 고도화 |
| **Cloud Functions 야간 유휴 절전 최적화** | `functions/src/index.ts` 내 통계 캐싱 스케줄러(`computeDashboardStats`)가 야간 시간대(20:00 ~ 08:00 KST)에는 실행을 패스하도록 최적화하여 불필요한 과금 및 리소스 대폭 절감 |
| **개발 환경 App Check 연동 및 배포** | 로컬 개발 환경(`http://localhost:5173`)의 디버그 토큰(`77d43479-352c-4378-92f6-4cc7c42903e5`)을 Firebase App Check에 안전하게 등록하여 실데이터 통신 연동. Git 마스터 브랜치 동기화 및 `origin/master` 푸시 후 Firebase Hosting 상용 서버(`live` 채널) 배포 성공 |

---

### Phase 58: 프로젝트 최적화, 리팩토링 및 기술 부채 이관 🚀 ✅

> 2026-06-09, 프로젝트 전반의 프론트엔드 빌드/로딩 성능 최적화, Firestore 쿼리 비용 최소화, Cloud Functions 4계층 물리 아키텍처 이관, 그리고 최종 Victory Audit 무결성 검증을 거친 종합 품질 검증 완료.

| 항목 | 내용 |
|------|------|
| **프론트엔드 초기 로딩 최적화** | `main.tsx` 및 `lightEntry.tsx` — 비로그인 시 Firebase SDK의 초기화를 지연시키고 경량 진입점 화면으로 빠르게 렌더링되게 분기. 대용량 라이브러리 `recharts` 및 `leaflet`을 Dynamic Import(지연 로딩)로 전환하여 초기 번들 크기 축소 |
| **Firestore 비용 및 쿼리 최적화** | `useReservationData.ts` — useEffect 의존성 불일치로 발생하던 무한 Firestore 리페치 루프를 수정하고 Zustand 전역 상태 및 쿼리 캐시 래퍼를 도입하여 중복 데이터 조회 비용 절감 |
| **Cloud Functions 4계층 물리 아키텍처** | `functions/src/` — `core`, `services`, `handlers`, `utils` 디렉토리를 물리적으로 분리 구축. `index.ts`는 복잡한 비즈니스 로직을 전혀 갖지 않는 순수 re-export 파일로 리팩토링 |
| **에러 알림 및 싱글톤 최적화** | `sentry.ts` — 분산되어 있던 `sendDiscordAlert` 호출을 Sentry의 `captureError` 내부로 완벽히 단일화하여 중복 알림을 완치하고, `GoogleGenAI` 모듈을 싱글톤(`getGeminiClient`)화하여 중복 호출 제거 |
| **테스트 무결성 강화** | `tests/firestore-rules.test.ts` — 테스트 스킵 우회 코드를 박멸하여 rules 검증 신뢰성을 강화하고, `vitest.config.js` 동적 배제를 통해 일반 빌드 환경과의 충돌 방지 |

---

### Phase 59: 전면 보안 감사 및 취약점 일괄 해소 🔒 ✅

> 2026-06-10, 프로젝트 전체(Firestore Rules·Storage Rules·Cloud Functions·프론트엔드·의존성) 보안 감사를 수행하고 발견된 취약점을 일괄 수정. npm 의존성 취약점 0건, 프로덕션 번들 내 API 키 미노출 검증 완료.

| 항목 | 내용 |
|------|------|
| **테넌트 격리 보강** | `src/lib/firestore/driveLogs/queries.ts` — `getVehicleDriveLogs`·`hasVehicleDriveLogs`에 누락됐던 `organizationId` 필터 추가 (절대 규칙 1번 위반 해소). 호출처 `useVehicleHistory`·`useVehicleManager` 시그니처 동기화 |
| **권한 상승 방어 (심층 방어)** | `setCustomClaims` 트리거와 `restoreUser`에 role 화이트리스트 검증 추가 — 정의되지 않은 role은 `employee`로 강등. `disableUser`에 admin의 superAdmin 비활성화 차단 추가 |
| **Storage 보안 강화** | `storage.rules` — `organizations/{orgId}/{allPaths=**}` 와일드카드를 단일 파일 경로로 축소하고 클라이언트 쓰기 전면 차단 (업로드는 `submitOrgApplication` Admin SDK 전용). `ocrDocument`에 storagePath 정규화 검증(`..`·역슬래시·선행 슬래시 거부) 추가 |
| **증빙 이미지 보존 기간 관리** | `dailyNightlyBatch.cleanupImages` — 승인 기관만 정리하던 것을 반려 기관(rejectedAt 30일 경과)까지 확장. 기존 쿼리에 누락됐던 `(status, approvedAt)`·`(status, rejectedAt)` 복합 인덱스를 `firestore.indexes.json`에 추가 |
| **민감정보 로그 마스킹** | `autoVerifyDocument`의 초대코드 평문 로깅 마스킹(`AB****`), `notifyNewApplication`·`sendFeedbackReply`의 수신 이메일 로깅 제거, 하드코딩된 관리자 이메일을 `ADMIN_NOTIFICATION_EMAIL` 환경변수로 이동(미설정 시 `GMAIL_USER` 폴백) |
| **PDF XSS 방어** | `src/lib/pdf/` 6개 파일 — `escapeHtml` 유틸을 `pdfStyles.ts`에 추가하고 기관명·운전자명·목적지·비고 등 사용자 입력의 `document.write` 보간 지점 전체에 적용 |
| **오탐 검증으로 불필요 작업 차단** | `.env` git 커밋 의혹(미추적 확인), T-Map·공휴일 API 키 번들 노출(빌드 산출물 검사로 미노출 확인), sa-test-role localStorage 권한 스푸핑(서버 검증 클레임 기반으로 안전) 모두 오탐 판정 |

---

### Phase 60: 기관 자발적 서비스 해지 & 이탈 통계 🚪 ✅

> 2026-06-13, 기관 관리자가 직접 서비스를 해지(탈퇴)할 수 있는 기능과, 슈퍼관리자가 자발적 탈퇴를 통계로 인식·확인할 수 있는 이탈 메트릭을 도입. 기존 30일 소프트 삭제/복구 인프라를 재사용하여 변경 범위 최소화.

| 항목 | 내용 |
|------|------|
| **탈퇴 메타데이터 모델 확장** | `src/types/organization.ts`·`src/schemas/organization.ts` — `WithdrawReason`(`no_longer_needed`·`too_difficult`·`missing_features`·`other`) 타입과 `WITHDRAW_REASON_LABELS` 맵 추가. `Organization`에 `deletedBy`(`admin`/`superAdmin`)·`withdrawReason`·`withdrawReasonDetail` 필드 추가. Zod 컨버터가 읽기 시 필드를 버리지 않도록 스키마 동기화 |
| **서버사이드 해지 처리 (callable)** | `functions/src/handlers/callable/withdrawOrganization.ts` 신규 — 호출자가 해당 기관 `admin`인지 검증 후 Admin SDK 배치로 소속 직원 user 문서 일괄 삭제 + 기관 `status='deleted'`·`deletedBy='admin'`·`withdrawReason` 기록. 클라이언트 직접 호출은 `users` delete가 superAdmin 전용이라 불가하므로 서버 경유. `index.ts`에 export 등록 |
| **출처 구분 표기** | `src/lib/firestore/organizations.ts` — 슈퍼관리자 `deleteOrganization()`에 `deletedBy='superAdmin'` 추가하여 자발적 탈퇴와 운영자 정리를 통계적으로 분리 (기존 데이터는 legacy로 처리) |
| **관리자 해지 UI (Danger Zone)** | `src/components/admin/WithdrawOrgModal.tsx` 신규 — 사유 선택(기타 시 상세 입력) + 기관명 type-to-confirm. `Settings.tsx`에 '서비스 해지' 카드 추가, `useSettings.handleWithdraw`가 callable 호출 후 본인 문서 삭제로 자동 로그아웃 흐름 연계. 설정 페이지 섹션 순서를 '앱 정보 → 내 계정 → 기관 정보·해지'로 재배치 |
| **슈퍼관리자 이탈 통계** | `src/components/superAdmin/OrgManagement.tsx` — '삭제된 기관' 탭에 자발적 탈퇴/운영자 정리 건수 및 사유 분포 요약 카드 추가(클라이언트 집계, 스케줄 함수 무변경). `DeletedOrgCard.tsx`에 '자발적 탈퇴' 뱃지 + 사유 라벨 표시 |
| **검증 및 배포** | `functions/src/__tests__/withdrawOrganization.test.ts` 권한 검증 단위 테스트 9건 추가(전부 통과). type-check·lint·build·functions build 통과 후 master 푸시 → CI Deploy(Hosting+Functions+Rules) 성공. FAQ(`shared/faqData.ts` `withdraw-service`)·업데이트 소식(`releaseNotes.json`) 갱신 |

---

### Phase 61: 인앱 브라우저 reCAPTCHA 렌더링 에러 해결 & Sentry 노이즈 억제 🔐 ✅

> 2026-06-14, Facebook 인앱 브라우저 등에서 발생하는 `reCAPTCHA has already been rendered in this element` 에러 해결을 위해 인앱 브라우저 진입 시 App Check 초기화 우회 조건 추가 및 Sentry ignoreErrors 필터 보강.

| 항목 | 내용 |
|------|------|
| **App Check 초기화 우회** | `firebase.ts` — 인앱 브라우저 환경(`isInAppBrowser() === true`)일 때 Firebase App Check(`initializeAppCheck`) 및 reCAPTCHA v3 초기화를 생략하도록 가드 조건식 수정. 불필요한 스크립트 로드 및 중복 렌더링 원천 차단 |
| **Sentry 노이즈 필터링** | `sentry.ts` — `ignoreErrors` 목록에 `'reCAPTCHA has already been rendered in this element'` 에러 패턴을 등록하여 Sentry로 전송되는 중복 렌더링 관련 무해한 외부 노이즈 제거 |
| **품질 검증 및 CI 빌드** | ESLint 린트, tsc 타입 체크, Vite 프로덕션 빌드, Vitest 단위 테스트(357건) 전체 통과 확인 |

---

### Phase 62: 초대 링크 자동 가입 (코드 입력 생략) 🔗 ✅

> 2026-06-17, 초대 링크(`?code=...`)로 접속한 직원이 코드 입력 화면 없이 Google 로그인만으로 소속 기관에 바로 연결되도록 가입 UX 개선. 백엔드(`joinOrganization`)·라우트는 무변경.

| 항목 | 내용 |
|------|------|
| **링크 코드 자동 가입** | `src/components/auth/InviteCodePage.tsx` — 마운트 시 링크/`localStorage`에 6자리 코드가 있고 정상 로그인(비익명) 상태면 `useEffect`로 `joinOrganization`을 자동 호출. 진행 중에는 입력 폼 대신 '기관에 연결 중...' 스피너 화면 표시. `autoTriedRef`로 StrictMode 중복 호출 방지 |
| **코드 없음·실패 폴백** | 코드 없이 접속하면 기존처럼 입력 폼 노출. 자동 가입이 실패(만료·오타 등)하거나 익명 상태면 자동 모드를 해제하고 에러 메시지와 함께 입력 폼으로 폴백해 직접 수정 가능. 가입 로직을 `joinWithCode()`로 추출해 폼 제출과 자동 가입이 공유 |
| **콘텐츠·문서 갱신** | 업데이트 소식(`releaseNotes.json`) 추가. type-check·lint 통과 |

---

### Phase 63: 차량 보험 만료일 & 만료 15일 전 관리자 알림 🛡️ ✅

> 2026-06-17, 차량별 보험 만료일을 입력·표시하고, 만료 15일 전부터 기관 관리자에게 앱 내 알림+푸시를 자동 발송. 신규 스케줄러 없이 기존 야간 배치에 단계 추가(비용 0).

| 항목 | 내용 |
|------|------|
| **보험 만료일 필드** | `src/types/vehicle.ts`·`src/schemas/vehicle.ts` — `insurance.expiryDate`(YYYY-MM-DD) 추가 + 백엔드 멱등 마커 `insuranceExpiryNotifiedFor`. `VehicleForm.tsx`에 만료일 `date` 입력, `useVehicleManager.ts` 초기값/로드/저장 연동 |
| **차량 카드 표시** | `VehicleManager.tsx` — 카드에 `· 만료 YYYY-MM-DD (D-N)` 표시. 잔여 15일 이하 빨강, 30일 이하 주황, 만료 시 '만료됨' 강조 |
| **만료 알림 배치** | `functions/src/handlers/scheduled/dailyNightlyBatch.ts` — Step 5 `checkInsuranceExpiry` 추가(매일 02:00 KST). 폐차 제외, 잔여 0~15일 & 미알림 차량만 대상. 기관 admin 단일 등식 쿼리+메모리 필터(복합 인덱스 불필요), `createInAppNotification`+`sendPushToUser` 발송 후 `insuranceExpiryNotifiedFor` 마킹으로 15일간 중복 방지(만료일 갱신 시 재알림) |
| **알림 아이콘** | `NotificationBell.tsx` — `insurance_expiry_warning` 🛡️ 아이콘 추가 |
| **검증** | 프론트 type-check·lint·build(번들 예산 내) 통과. functions 빌드 + `dailyNightlyBatch.test.ts`에 보험 만료 판단 단위 테스트 10건 추가(총 21건 통과) |

---

### Phase 64: 하네스 측정 인프라 강화 & 보안·무결성 감사 🧪🔒 ✅

> 2026-06-18, 에이전트 하네스의 측정(eval) 인프라를 강화하고(스킬 트리거 eval 포화 진단 → 행동 규칙 회귀 세트·자동 러너 신설), 강화된 규칙을 렌즈로 기존 코드를 보안·무결성 감사하여 무결성 갭 1건을 외과적으로 수정. CI 배포는 익일(2026-06-19) 사용자 피크 이후로 보류.

| 항목 | 내용 |
|------|------|
| **행동 규칙 회귀 세트 신설** | 기존 `scripts/skill-trigger-eval.json`(22케이스)이 100%로 포화(변별력 소진)임을 측정으로 확인. 자동 감지 불가한 판단형 Don'ts(D7·D8·D9·D11) 준수율을 재는 `scripts/behavior-rule-eval.json`(위반유도+음성 10케이스) 추가 — 카탈로그 블라인드 판정이 아니라 **fresh 서브에이전트 실제 실행** 기반 측정. 베이스라인 9/10 |
| **D11 규칙 환류** | 행동 eval에서 발견: 에이전트가 승인/거절 등 워크플로-변이에서 라우터 가드(`AuthGuard`)를 권한 보장으로 착각해 백엔드 재검증을 누락. `.agent/rules/role-based-access.md §2`에 "라우터 가드도 프론트엔드 / 변이는 동사로 판단하지 않는다" 명시 후 재측정으로 닫힘 확인(9→10) |
| **eval 자동 러너** | `scripts/run-eval.ts`(emit/score/baseline) + `scripts/eval-baselines.json` 신설, `package.json`에 `eval:trigger`·`eval:behavior` 배선. LLM 판정은 운영자가 수행하고, 프롬프트 조립·채점·베이스라인 회귀 diff(회귀 시 exit 1)는 결정론적으로 담당 (커밋 `9ff1575`) |
| **기존 코드 보안 감사 (렌즈 적용)** | 강화된 D11로 권한성 변이 전수 감사 → Firestore Rules가 권한 대부분을 이미 강제함을 확인(탐색 에이전트의 "79건 위험"은 Rules 게이팅 누락 과대경보). `sendAdminNotice`는 의도 검증 결과 '전 직원 발송 가능'이 정상이라 **변경 없음**(기계적 적용 시 employee UI 파손 회피) |
| **무결성 수정: 기관 승인 원자화** | `OrgApplicationList.handleApprove`의 순차 `updateOrganization`→루프 `updateUser`를 `organizations.ts` 신규 `approveOrganizationWithAdmins`(`writeBatch`)로 대체해 기관·관리자 상태를 원자 커밋(부분 실패 불일치 제거). 승인 오케스트레이션을 도메인 계층으로 이관(기술 부채 D9 항목 부분 해소). 알림·이메일·알림톡은 best-effort 유지 + 승인 실패 토스트 추가 (커밋 `969fcaa`) |
| **검증 & 배포 보류** | lint·tsc·관련 테스트 105건·빌드(번들 예산 내)·프리커밋 훅 통과. 이 수정은 superAdmin 신규 기관 승인 경로에만 영향(일일 사용자 무관)하나, 피크 전야 전체 재배포 리스크를 피해 **푸시를 2026-06-19 이후로 보류**. 두 커밋(`9ff1575`·`969fcaa`) 로컬 백업 |

---

### Phase 65: 품질 개선 1차 정리 — 환경 가드·Functions 린트·구조 분리 🧹 ✅

> 2026-06-21, 평가에서 도출된 개선점을 **동작 변경 없이** 1차 정리. E2E·Node 22 환경 가드, Functions ESLint/type-check 도입(+CI 스텝), 비-React 모듈 `alert()` 제거, 대형 파일 구조 분리, Functions `any` 점진 타입화. PR #38 squash 머지(`e61b05d`) → 프로덕션 배포 완료(Hosting + Functions·Rules).

| 항목 | 내용 |
|------|------|
| **개발 환경 가드** | E2E 프리플라이트(`scripts/check-e2e-ready.ts` + `pretest:e2e`)로 Chromium 미설치를 네트워크 다운로드 없이 명확히 안내. Node 22 가드(`scripts/check-node-version.ts` + `prebuild` 경고 + 루트 `engines`)로 Node 24 빌드 실패를 조기 경고 |
| **Functions 품질 검사 도입** | 루트 `eslint.config.js`가 functions(Node/ESM)까지 린트하도록 확장 + `lint:functions`/`type-check:functions` 스크립트. CI(`ci.yml`)에 `Type check (functions)`·`Functions unit tests`(jest, OOM 방지 `--maxWorkers=2 --workerIdleMemoryLimit=512MB` + 힙 4GB) 스텝 추가 |
| **alert() 제거 → toast 브릿지** | 비-React 모듈 `firebase.ts`의 저장공간/캐시 오류 `alert()`를 Zustand 기반 toast 브릿지(`src/lib/notify.ts`, `getState()` 활용)로 대체 + 단위 테스트 |
| **대형 파일 분리 (동작 보존)** | `VehicleTimelineBar`→`VehicleTimelineRow`/`ReservationAccordion`, `Settings`→`OrgInfo`/`ReservationApproval`/`ApprovalLine`/`Account` 섹션 + `useSettingsModals` 훅, SuperAdmin 통계 `computeReservationStats` 순수함수 추출. 각 분리에 특성화 테스트 동반 |
| **Functions any 점진 타입화** | 소스 33곳의 `any`를 의미 있는 타입으로 교정(`FirebaseFirestore.DocumentData`, `Parameters<typeof fn>[n]`, `InstanceType<typeof google.auth.OAuth2>`, 외부 API 응답 최소 인터페이스 등). 테스트·일회성 스크립트는 정책상 규칙 완화. `npm run lint`(functions 포함) **0 errors / 0 warnings** |
| **검증 & 배포** | 프론트 단위 401건·functions 179건 테스트 통과, lint·type-check·build(번들 예산 내) 통과. CI 전체 통과 후 머지 → `Deploy` 워크플로로 Hosting + Functions·Rules 프로덕션 배포 완료. 후속 권장: functions ESLint 규칙 점진 강화, Settings 결재라인 외 잔여 분리는 백로그(`docs/MAINTAINABILITY_BACKLOG.md`) |

---

### Phase 66: 내보내기 중복 제거 & 거대 제출 훅 외과적 분리 (동작 보존) 🧹 ✅

> 2026-06-26, 탐색 에이전트가 보고한 "최적화 후보"를 실제 코드로 **검증**한 결과 번들(lazy+manualChunks)·대시보드 통계(배치 캐싱)·알림톡 N+1(주간 신규 한 자릿수) 등 큰 건은 이미 처리됨을 확인. 실제로 유효한 중복·복잡도 핫스팟 2건만 동작 변경 없이 정리. plan-review(HOLD 모드) 승인 후 진행.

| 항목 | 내용 |
|------|------|
| **내보내기 필드 별칭 해석 통합** | 운행일지 구·신 필드명(startKm/departureKm, startTime/departureTime 등) 별칭 해석이 `excelExport.ts`·`pdfExport.ts`에 중복(동일 주행거리 계산식만 4회). 순수 함수 모듈 `src/lib/driveLogExportFields.ts`(resolveDistance/resolveDateStr/resolveStartKm/resolveEndKm/resolveStartTime/resolveEndTime) 신설 후 양쪽이 공유. 정렬·표시·합계가 단일 규칙 사용. 단위 테스트 17건 |
| **useDriveLogSubmit 외과적 분리** | 343줄 훅의 핫스팟인 `handleSubmit`(~170줄)에서 순수/부수 로직 추출 — 수정모드 km 범위 검증→`editKmRange.ts`(`validateEditKmRange`), 인접 기록 자동조정 raw `updateDoc`→`adjustAdjacentLogs.ts`, 거대 인라인 `onError`→`handleSubmitError` useCallback. `handleSubmit` ~170→~70줄. **공개 API·`SubmitDeps`·소비처(`useDriveLogForm`) 무변경.** 추출 함수 단위 테스트 11건(km 범위 경계·인접 조정 실패 삼킴 포함) |
| **전제 도전(채택 안 함)** | 서브에이전트의 "3~4개 훅 전면 분해(C안)"는 핵심 로직(`submitDriveLog`)이 이미 추출돼 있어 wiring만 재배치되고 소비처 재테스트 부담이 커 미채택. 규모 적합 축소 편향 적용 |
| **검증** | Node 22로 lint(0 errors)·tsc·build(번들 예산 내)·관련 테스트 통과(기존 `submitDriveLog`·`useDriveLogForm` 테스트 그린 유지 + 신규 28건). 동작 변경 0 |

---

### Phase 67: 헬스 체크 스케줄러 상태 오탐 수정 (cron 활성 창 인지) 🩺 ✅

> 2026-06-27, 슈퍼관리자 헬스 체크에서 "예약 알림"·"캘린더 싱크"가 주말·야간마다 빨갛게(에러) 뜨던 구조적 오탐을 수정. 두 스케줄러는 비용 절감을 위해 평일 업무시간에만 도는 cron인데, 헬스 체크가 활성 창을 모르고 단순 경과시간으로 판정한 것이 원인. (별건으로 캘린더 동기화 "61대 영구중단"은 오탐이 아닌 실제 공유 누락 문제로 확인 — 운영 대응 영역.)

| 항목 | 내용 |
|------|------|
| **근본 원인** | `reservationReminder`(cron `0 8-18 * * 1-5`)·`syncCalendarToApp`(cron `0 6-22 * * 1-5`)는 평일 업무시간에만 실행. 그러나 `apiHealthCheck`의 `checkSchedulerHealth`가 `expectedIntervalMs`(30분/4시간) 단순 경과만 봐서 주말·야간엔 정상인데도 매번 "에러". 설정 주석("15분마다/2시간마다")도 실제 cron(매시간)과 불일치 |
| **수정** | `functions/src/handlers/https/apiHealthCheck.ts` — `SCHEDULER_CONFIG`에 `activeWindow`(요일·시간대) 추가 + 주석/주기 정정. 판정 로직을 순수 함수 `getLastScheduledTick()`·`evaluateSchedulerStatus()`로 분리: 활성 창 밖(주말/야간)이면 정상, 평일 업무시간에 **직전 예정 정각을 실제로 놓쳤을 때만** 에러(정각 직후 15분 유예). 공휴일 동기화(상시)는 기존 경과시간 방식 유지 |
| **검증** | Node 22로 functions build(tsc)·신규 단위 테스트 `apiHealthCheck.test.ts` 10건 통과(주말 오탐 방지·평일 정상/누락·유예·null degraded·상시 경과 케이스). lint-staged(eslint·vitest) 통과 |
| **별건 확인(코드 변경 없음)** | 함수 로그상 `syncCalendarToApp`이 매 주기 `skippedPermanent 61`로 일정 — 61대가 `calendarSyncFailCount≥10`로 영구 제외돼 API 호출조차 스킵 중(그래서 신규 403/404 로그 없음). 정상 차량은 동기화 동작. 원인은 기관의 서비스 계정 캘린더 공유 누락/권한 부족으로 추정. 공유 정정 후 헬스 체크 "🔄 동기화 리셋"으로 카운터 초기화 필요 |

---

### Phase 68: 온디맨드 캘린더 동기화 백오프 우회 차단 & 실패 카운터 캡 🔁 ✅

> 2026-06-27, Phase 67 후속 진단에서 영구중단 차량의 `calendarSyncFailCount`가 10에서 멈추지 않고 192·184·121회까지 치솟는 이상을 발견. 예약 캘린더 진입 시 자동 호출되는 온디맨드 동기화 콜러블이 백오프 가드를 우회한 것이 원인으로, 가드 추가 + 카운터 캡으로 수정.

| 항목 | 내용 |
|------|------|
| **근본 원인** | `triggerOnDemandCalendarSync`(콜러블)는 `useReservationData`가 예약 캘린더 진입 시 차량별로 **백그라운드 자동 호출**(브라우저 30분 쿨다운)한다. 그런데 스케줄러·예약 트리거와 달리 `shouldSkipVehicleCalendar` 가드가 없어, 공유가 깨진 차량에서 매 호출마다 403/404 → `recordCalendarFailure`로 카운터가 MAX(10)를 넘어 무한 증가하고 Google Calendar API 쿼터를 낭비 |
| **수정 1 — 가드 추가** | `functions/src/handlers/callable/triggerOnDemandCalendarSync.ts` — 동기화 실행 전 `shouldSkipVehicleCalendar` 체크. 영구제외/쿨다운 차량은 API 호출 없이 `success:false`(errorType `calendar-not-found`) 반환 → 클라이언트가 기존 로직대로 30분 쿨다운 적용 후 조용히 중단(사용자 노출 토스트 없음) |
| **수정 2 — 카운터 캡** | `functions/src/services/calendar/calendarFailTracking.ts` `recordCalendarFailure` — `Math.min(currentFailCount + 1, MAX_FAIL_COUNT)`로 캡. 다른 경로가 가드를 빠뜨려도 카운터가 192처럼 무한 증가하지 않게 하는 방어적 불변식 |
| **검증** | functions build(tsc) + 신규 `calendarFailTracking.test.ts` 7건(쿨다운/영구제외 판단·카운터 캡·오염값 수렴) + 기존 `reservationTriggers` 11건 회귀 통과. lint-staged 통과 |
| **운영 메모** | 영구중단 61대(24개 기관)는 대부분 서비스 계정 캘린더 미공유/개인 캘린더 ID 입력이 원인. 본 수정은 카운터 오염·쿼터 낭비를 멈출 뿐 동기화를 복구하진 않음 — 기관별 공유 정정 후 "🔄 동기화 리셋" 필요. 점검용 읽기 스크립트 `scripts/list-calendar-failures.ts`(ADC) 사용 |

---

### Phase 69: 운행일지 내보내기 '주유 포함' 열 추가 ⛽ ✅

> 2026-07-01, 관리자 운행일지 내보내기(엑셀·PDF)에 `주유 포함` 옵션을 추가. 별도 컬렉션(`fuelLogs`)의 주유금액·주유량을 `차량+날짜`로 조인해 한 열로 내보낸다. 기존 `하이패스 포함`·`동행자 포함` 옵션과 동일 패턴(내보내기 전용, 화면 목록 표 무변경).

| 항목 | 내용 |
|------|------|
| **체크박스 UI** | `DriveLogExportBar`에 `하이패스 포함` 왼쪽으로 `주유 포함` 체크박스 추가. 상태는 `useDriveLogExport`(`includeFuel`)에서 관리하고 `useDriveLogList`→`DriveLogList`로 배선 |
| **주유 조인 (그날 첫 운행 행)** | `driveLogExportFields.ts`에 순수 함수 `attachFuelSummary` 신설 — `getFuelLogs(orgId, vehicleId, {since,until})`로 받은 주유 기록을 `차량+날짜`로 합산하고, 그날 첫 운행(출발 시각 오름차순) 행에만 `주유금액(주유량)` 문자열(예 `50,000(35.5L)`) 부착. 나머지 행은 비워 열 합계 중복 방지. 연료 유형별 단위(L/kWh/kg) 반영 |
| **엑셀/PDF 열** | `excelExport.ts`는 하이패스 열 앞에 `주유금액(주유량)` 컬럼(+너비) 추가. `pdfExport.ts`는 탑승인원 뒤에 `동행자` 열과 동일 패턴으로 주유 열(`col-fuel`) 추가(소계/합계 colspan 정렬 유지). `getFuelLogs` since/until 타입을 `Date | string`으로 확장 |
| **검증** | Node 22로 type-check·lint(0 errors)·build(번들 예산 내 3100.6KB)·전체 단위 테스트 450건 통과. `attachFuelSummary` 신규 테스트 5건(합산·첫 행 부착, 연료 단위, timestamp 매칭, 미매칭 미부착, 빈 입력) |
| **한계** | `getFuelLogs` limit 200 — 초대형 기관이 3개월 전체를 추출하면 최근 200건만 조인될 수 있음(현 규모 충분). 화면 목록 표(`DriveLogTableRow`)·Firestore 인덱스 무변경 |

---

### Phase 70: 에이전트 하네스 재정비 — 훅 가드·브리지 자동화·정합성 🔧 ✅

> 2026-07-03, 하네스 엔지니어링 관점의 전수 점검. 스킬·룰·워크플로우·훅 간 불일치와 이름 충돌을 정리하고, 규칙 2건(로컬 배포 금지·브리지 동기화)을 에이전트 기억이 아니라 훅이 강제하도록 전환. 코드(src/functions) 변경 없음.

| 항목 | 내용 |
|------|------|
| **훅 2건 신설** | `scripts/hooks/guard-firebase-deploy.mjs`(PreToolUse) — 로컬 `firebase deploy`(npx/firebase-tools 변형 포함) 감지 시 자동 승인을 "ask"로 강등해 CI 단일 경로 규칙을 하네스가 강제(긴급 수동 배포는 사용자 승인으로 통과, `emulators:exec` 오탐 없음). `scripts/hooks/sync-agent-bridge.mjs`(PostToolUse) — `.agent/skills`·`.agent/workflows` 편집 직후 `.claude/` 브리지 자동 재생성("sync 누락 → CI `--check` 실패" 루프 제거). 훅 3종 stdin BOM 방어 추가 |
| **이름 충돌 해소** | `cleanup` 스킬 ↔ `/cleanup` 워크플로우가 동명으로 등록돼 Skill 해석이 모호 → 스킬을 `code-cleanup`으로 리네임 + description 트리거 문구 보강. `skill-trigger-eval.json`·`eval-baselines.json` 케이스 20 동반 갱신(블라인드 재측정 권장). `/sync-configs`에 스킬↔워크플로우 이름 충돌 자동 검사 단계 신설 |
| **정합성 수정** | CLAUDE.md — 룰 개수 오기(12 → 실제 16, 부패 방지 위해 개수 표기 제거), 스킬 테이블 누락 2건(pre-deploy-check·sentry-noise-filter) 추가. agents.md — D18/D19의 깨진 `[user_global](rules)` 링크 정리(기존 검사가 `.md` 링크만 봐서 못 잡던 유형 → `/sync-configs` 정규식을 비-.md 링크까지 확장). 고아 룰(참조 0건) multi-agent-coordination을 agents.md 헤더에서 참조 연결 + 낡은 개수(15/25/21개)·"agents.md는 Antigravity 전용" 문구 현행화 |
| **워크플로우 스테일 수정** | `/db-seed` — 존재하지 않는 `npm run dev:firebase`·가상 `seed-db.js` 안내를 실제 인프라(`e2e/emulator/seed.ts` 단일 원본, `emulators:start --only auth,firestore`, `--mode emulator --host 127.0.0.1`) 기준으로 재작성. `/health` — 미추적으로 떠돌던 `scripts/check-health-heartbeats.ts`(스케줄러 heartbeat 진단, 읽기 전용·ADC)를 선택 단계로 정식 연결·커밋 |
| **검증** | `sync:agents --check` 통과, 팬텀 링크·스킬↔워크플로우 이름 충돌·고아 룰·CLAUDE.md 누락 스킬 0건, settings.json·평가 JSON 파싱 OK, 훅 ESLint 0건 + 동작 테스트(deploy 감지/오탐/대상 외 경로) 통과 |
| **의도적 미채택** | 프로젝트 서브에이전트(`.claude/agents/`) 신설 안 함 — 현 규모에선 내장 에이전트로 충분(규모 적합 축소 편향). `settings.local.json` 일회성 권한 12건 정리는 자동 승인 분류기가 차단해 사용자 수동 몫으로 이관 |

---

### Phase 71: 내보내기·월간보고서 주유/하이패스 조인 200건 한도 제거 ⛽ ✅

> 2026-07-03, 종합 감사(P1-1)에서 확인된 정확성 버그 수정. 내보내기는 운행일지를 최대 5,000건(`EXPORT_MAX_DOCS`) 조회하는데 주유 조인(`getFuelLogs`)과 월간 보고서 하이패스 집계(`getAllHipassCharges`)는 `limit(200)` 하드코딩이라, 장기간·다차량 추출 시 최근 200건 이후 기록이 **조용히 누락**되어 공식 문서의 금액 열이 부정확해질 수 있었다(Phase 69 "한계"로 기록됐던 항목의 해소).

| 항목 | 내용 |
|------|------|
| **수정** | `getFuelLogs`·`getAllHipassCharges` — 기간(since/until) 지정 조회는 상한을 200 → **5,000건**(운행일지 내보내기 상한과 동일 수준)으로 확대. 기존 내보내기 관용구(`getAllDriveLogsForExport`의 `limit(상한)` 단발 쿼리)를 재사용하고, 상한 도달 시 `console.warn`으로 조용한 누락을 가시화. **기간 미지정 화면 목록 조회(주유 관리 탭 등)는 기존 200건 유지**(화면 회귀 없음) |
| **테스트** | `src/__tests__/lib/fuelHipassRangeFetch.test.ts` 신규 7건 — 기간 지정/미지정별 limit 인자 검증, 상한 도달 경고. 관련 기존 테스트(`useMonthlyReport`·`driveLogExportFields`·`useDriveLogExport`) 그린 유지 |
| **사용자 안내** | 업데이트 소식(`releaseNotes.json`)에 수정 안내 추가 |
| **검증** | Node 22로 tsc·관련 테스트 34건·build 통과 |

---

### Phase 72: 배포 파이프라인 게이트 재구조 — CI 성공 종속 + Rules·인증 E2E·커버리지·번들 게이트 🚦 ✅

> 2026-07-03, 종합 감사(P1-2·3)의 구조적 결함 수정. 기존에는 master 푸시 시 `ci.yml`과 `deploy.yml`이 **각자 독립 실행**되어 CI(lint·함수 테스트·E2E 등)가 실패해도 배포가 진행됐고, Firestore Rules 테스트·인증 E2E·커버리지 임계치·번들 예산은 어느 게이트에도 없었다.

| 항목 | 내용 |
|------|------|
| **배포를 CI에 종속** | `deploy.yml` 트리거를 `push` → `workflow_run`(CI 완료 시)으로 전환, `conclusion == 'success'`일 때만 배포. checkout을 `workflow_run.head_sha`로 고정해 **CI가 검증한 바로 그 커밋**을 배포(사이에 새 푸시가 끼어도 안전). `workflow_dispatch` 수동 우회 경로·concurrency(동시 배포 방지)는 유지 |
| **Rules 테스트 CI 편입** | 멀티테넌트 격리의 유일한 자동 검증이 CI 0회 실행이던 공백 해소 — `setup-java`(temurin 17) + `npx firebase-tools emulators:exec --only firestore`로 `tests/firestore-rules.test.ts` 실행. Firebase 에뮬레이터 jar 캐시 추가 |
| **인증 E2E CI 편입** | `emulators:exec --only auth,firestore` 위에서 `playwright.emulator.config.ts`(authed-* 4개: 로그인·역할 리다이렉트·오프라인 큐 동기화) 실행. `.env.emulator`는 git 추적 파일이라 CI에서 바로 사용 가능 확인 |
| **커버리지·번들 게이트화** | CI Unit tests를 `vitest run --coverage`로 변경(vitest.config.js 임계치 lines 24 등 강제). `check-bundle-size.ts`가 예산 초과 시 경고만 하던 것을 `process.exit(1)`로 게이트화(postbuild·CI 공통). Playwright 브라우저 캐시 추가(CI 시간 단축) |
| **썩은 E2E 발견·수정 (CI 부재의 실증)** | 편입 전 로컬 실행에서 `authed-offlineSync.spec.ts` 실패 — CI 밖에서 3중으로 썩어 있었음: ① 라우트 개편 후 존재하지 않는 `/drive-logs/new`로 이동(실제 `/employee/drive-log`), ② 테스트 작성 후 추가된 "운행당 10,000km 초과 금지" 검증에 도착 km 999999가 걸려 제출 거부(토스트는 4초 뒤 소멸해 무증상), ③ 최종 큐 검증이 존재한 적 없는 IndexedDB(`veh-log-offline-sync/action-queue`)를 열어 항상 공허 통과. 실제 계약 기준으로 재작성 — 실 큐(`sync-db/sync-store`) 적재 확인 → 오프라인 성공 시 폼 리셋 확인 → 재접속 후 서버(에뮬레이터) 반영을 내 기록 화면에서 확인. networkidle 대기(Firestore 리스너로 도달 불가)도 요소 가시성 대기로 교체 |
| **검증** | 워크플로 이름 정확 일치 확인, js-yaml 파싱 OK, 번들 게이트 exit 코드 동작 확인, 로컬 인증 E2E 4/4 그린 확인 후 푸시. 첫 CI 런에서 firebase-tools 15.x의 Java 21 요구로 Rules 스텝 실패 → **Deploy가 workflow_run에서 skipped 처리되어 게이트 구조 자체가 실전 입증됨**. Java 17→21 교정 후 재검증 |

---

### Phase 73: notifications 생성 규칙 잠금 & Rules 테스트 고위험 컬렉션 확대 🔒 ✅

> 2026-07-03, 종합 감사(P2-5·P1-3 후반) 적용. ① 임의 서명 사용자가 UID만 알면 타 기관 사용자에게도 인앱 알림 텍스트를 주입할 수 있던 `notifications` create 규칙을 잠그고, ② 17개 컬렉션 중 3개(vehicles·driveLogs·users)만 커버하던 Rules 테스트를 고위험 컬렉션까지 확대했다. Phase 72로 이 테스트가 CI 게이트가 된 직후의 첫 확대.

| 항목 | 내용 |
|------|------|
| **notifications create 잠금** | 클라이언트 생성처를 전수 확인 — superAdmin 승인/반려 화면(`OrgApplicationList.tsx`) 1곳뿐이고 나머지 알림은 전부 Cloud Functions(admin SDK, Rules 우회) 생성. `isSignedIn() && organizationId == 내 orgId` 분기(targetUid 소속 미검증 → 타 기관 UID 주입 가능)를 제거하고 `allow create: if isSuperAdmin()`으로 축소. 화면 동작 무변경 |
| **Rules 테스트 3→7건, 컬렉션 3→7개** | 신규: ⑤ `reservations` 조직 격리(타 조직 조회/생성 차단·명의 위조 차단·정상 생성 허용), ⑥ 비용 3종(`fuelLogs`·`hipassCharges`·`maintenanceRecords`) 교차 조직 read 차단 + 본인 조직 정상 조회, ⑦ `notifications` 생성 superAdmin 전용·본인 대상만 조회. 기존 4건(테넌트 격리·권한 상승·주입/역행·관리자 정상 동작) 유지 |
| **검증** | 로컬 에뮬레이터 `npm run test:rules` 7/7 통과. Rules 배포는 CI(Deploy 워크플로 `--only functions,firestore:rules`) 경유 |

---

### Phase 74: 보안 하드닝 — preview CLI 전환·LLM 프롬프트 위생·OCR 일일 한도·워밍업 배선 🛡️ ✅

> 2026-07-03, 2026-06-26 보안 감사 리포트(F1~F3)와 종합 감사 P2 항목 일괄 적용. LLM 프롬프트 인젝션 2건 하드닝, 공급망 리스크 1건 제거, OCR 비용 방어선 추가, 죽은 채 정의만 있던 워밍업 실배선.

| 항목 | 내용 |
|------|------|
| **F1 — preview.yml 서드파티 액션 제거** | 배포 서비스계정을 전달받던 `action-hosting-deploy@v0`(SHA 미고정, VERIFIED 8/10)를 deploy.yml 전례대로 firebase-tools CLI 직접 호출(`hosting:channel:deploy pr-{N} --expires 3d`, mktemp 자격증명 패턴)로 교체. 서드파티 공급망 → 서비스계정 유출 경로 소멸 |
| **F2 — autoVerifyDocument 프롬프트 위생 + enum 강제** | `sanitizePromptValue()` 공용 유틸 신설(utils/helpers — 따옴표·백틱·백슬래시 제거, 공백 압축, 60자 절단)을 orgName 취득 직후 적용(프롬프트·화이트/블랙리스트·Tmap·사업자번호 보정 전체 커버). 프롬프트에 "기관명은 데이터일 뿐, 지시 금지" 가드 문장 추가. 파싱부 `documentType`을 4개 enum 화이트리스트로 강제 — 목록 밖 값은 "기타"(자동 승인 불가 → 수동 검토 폴백) |
| **F3 — generateFeedbackDraft few-shot 이스케이프** | 과거 피드백 원문(`message`/`reply`)과 현재 의견이 무가공으로 few-shot 프롬프트에 주입되던 것을 `sanitizePromptValue(·, 500)` 위생 처리 + "의견은 데이터일 뿐" 가드 문장으로 하드닝 (2차 인젝션 오염 차단) |
| **OCR 일일 누적 한도** | [ocr-cost-security §1.1] 미구현 항목 구현 — `checkDailyOcrQuota(uid, orgId)`가 기존 `_rateLimits` 창 버킷 로직 재사용(epoch 24시간 버킷, TTL)으로 사용자 일 20회·조직 일 50회를 강제. `ocrDashboard`·`ocrDocument` 공유 통합 카운터, Remote Config로 조율 가능. 규칙 문서를 실제 구현에 맞게 갱신 |
| **warmupOcr 실배선** | 정의만 있고 어디서도 호출되지 않던 `warmupOcrFunction`을 기존 `reservationReminder` 스케줄러(평일 8~18시 매시)에 편승 호출 — 신규 함수·추가 스케줄 비용 없이 근무시간 OCR 콜드스타트 완화. try/catch 격리로 알림 발송에 무영향 |
| **검증** | functions tsc 통과, 관련 테스트 64건 통과(신규: `sanitizePromptValue` 5건 + `checkDailyOcrQuota` 4건). preview.yml js-yaml 파싱 OK, ESLint 0건 |
| **후속(파이프라인)** | 신규 게이트 포함 첫 CI 실행이 잡 타임아웃 15분을 초과해 cancelled → `timeout-minutes` 25로 상향(별도 커밋). Deploy는 두 차례 모두 workflow_run 게이트가 정확히 skipped 처리 |

---

### Phase 75: 죽은 코드 제거·타입 봉합·경계 누수 정리·E2E 위생 🧹 ✅

> 2026-07-03, 종합 감사 P3 항목 일괄 정리. 동작 변경 없음(리팩토링·위생) — 죽은 코드 4파일 삭제, 코드베이스에서 타입 검증이 무력화된 유일한 지점 봉합, 컴포넌트 경계 누수 1건 도메인 흡수, E2E 위장 잔재 정리.

| 항목 | 내용 |
|------|------|
| **functions 죽은 코드 4파일 삭제** | `backupFirestore.ts`(로직은 dailyNightlyBatch에 복제돼 살아있음)·`discordScheduler.ts`(sendInactiveOrgAlimtalkScheduled에 통합됨) — 둘 다 index.ts 미등록 스케줄 정의 잔재. `calendarWebhook.ts`(미배포 onRequest — 배포 시 미인증 엔드포인트가 될 위험 제거)와 그 전용 운영 스크립트 `registerCalendarWatch.ts`. add-cloud-function 스킬 문서의 예시 트리도 동기 정리 |
| **isQuickDrive 죽은 분기 제거 (폼 계통)** | `useDriveLogForm`의 상수 `false` 플래그가 `SubmitDeps`→`validateDriveLogForm` 도달불가 분기까지 관통하던 것을 제거 + 미사용 `validateForm` 래퍼 삭제. **예약 문서 필드 `isQuickDrive`(바로 운행, 라이브)는 별개 계통으로 불변** |
| **useServiceDashboard any 7필드 타입화** | 코드베이스에서 컴파일 검증이 무력화된 유일한 라이브 지점 — 기존 타입(`FuelStatsData`·`HipassStatsData`·`NotifSummaryData`) 재사용으로 `DashboardExternalState` 완전 타입화. 파일 상단 `eslint-disable no-explicit-any`도 제거됨 |
| **반려 경로 도메인 흡수** | 컴포넌트 raw-SDK 사용 0건 경계의 유일한 균열이던 `PendingReservationList`의 `serverTimestamp` 직접 조립을 `rejectReservation(id, reason)` 도메인 함수로 캡슐화. `Reservation.rejectedAt` 타입 필드 추가, 캐스팅 제거, 테스트 어서션 갱신 |
| **E2E 위생** | `error-recovery.spec.ts` 본문 중간 `test.fixme()`(속 빈 테스트)를 선언형 fixme로 정직화. `offline-pwa.spec.ts`의 fixme 2건 삭제(가공의 IndexedDB를 보던 큐 테스트 포함 — authed-offlineSync가 실계약으로 대체). `core-workflows`·`reservation-approval`의 낡은 "인프라 부재" 사유를 현행(authed-* 이관 가능)으로 갱신 |
| **Storage lifecycle 보증** | `/health` 워크플로우에 `gsutil lifecycle get` 확인 단계 추가 — 선언(`storage-lifecycle.json`)만 있고 수동 적용에 의존하던 규칙의 적용 여부를 운영 점검에 편입 |
| **검증** | 프론트·functions tsc 통과, 관련 테스트 35건 통과, build(번들 예산 내) 통과. 동작 변경 0 |

---

### Phase 76: 운영 후속 정리 — 헬스 체크 복구·보안 잔여물 커밋·로컬 권한 정리 🧹 ✅

> 2026-07-03, Phase 71~75 마무리 후속. 감사 과정에서 확인된 미커밋 잔여물과 이 머신에서 동작하지 않던 헬스 체크를 정리했다.

| 항목 | 내용 |
|------|------|
| **헬스 체크 스크립트 복구** | `check-functions-health.ts`가 이 환경에서 3중으로 죽어 있었음 — ① `2>/dev/null` POSIX 리다이렉트가 Windows cmd에서 즉사(`stdio` 옵션으로 대체), ② `npx firebase-tools` 매회 다운로드로 30초 타임아웃(전역 `firebase` CLI + 60초로 전환), ③ 현행 CLI에서 제거된 `--limit` 옵션(`--lines`로 교체). 추가로 본문 문자열 매칭(`error|failed|exception`)이 DEBUG 폴백 로그(Remote Config NOT_FOUND 등)까지 에러로 세던 것을 **심각도 문자(D/I/W/E) 기반 분류**로 교정 — 오탐 13건 → 실제 E 2건(기존 티맵 빈 응답 건)으로 정상화 |
| **보안 세션 잔여물 커밋** | 직전 보안 세션의 미커밋 결과물 정리 — functions `ts-deepmerge` 전이 의존성 override(`^8.0.0`, 락파일 정합 확인) 및 2026-06-26 `/cso` 보안 감사 리포트(F1~F3 원 발견 기록 — 조치는 Phase 73~74에서 완료) |
| **로컬 권한 정리** | `.claude/settings.local.json`의 일회성 절대경로 허용 12건 제거, 범용 5건(`npm run *`·`npx tsc/eslint/vitest/jest *`)만 유지 |
| **검증** | `npm run health` 실기 재실행으로 로그 112줄 수집·심각도 분류 확인 |

---

### Phase 77: 리팩토링·최적화 — 번들 로딩 경로 교정·대시보드 스캔 방어·functions 중복 정리 ⚡ ✅

> 2026-07-03, 리팩토링·최적화 일괄 작업. 병렬 탐색(번들·Firestore 읽기·중복 구조) 후 확정 발견만 선별 적용 — 총 번들 크기는 유지하되 로딩 경로를 교정하고, superAdmin 대시보드의 무제한 전 테넌트 스캔을 봉쇄, functions 보안 가드·메일 발송 중복을 단일화했다.

| 항목 | 내용 |
|------|------|
| **react-vendor 청크 교정** | manualChunks가 `react-dom` 패키지 루트만 지정해 실제 렌더러(`react-dom/client`)·jsx-runtime·scheduler가 **매 배포마다 해시가 바뀌는 앱 공유 청크에 인라인**되던 것을 서브패스 명시로 교정. react-vendor 48→225KB(버전 업 전까지 캐시 유지), 공유 청크 252→75KB — 배포 때마다 ~150KB 재다운로드되던 캐싱 낭비 제거 |
| **Sentry 진짜 지연 로딩** | `sentry.ts`의 정적 `import * as Sentry`가 lightEntry(비로그인) 경로에 SDK 139KB를 정적 유입시키고 appEntry의 지연 초기화(`import().then(initSentry)`) 의도를 무력화하던 것을 동적 import로 전환. 함정 2개를 우회: ① 패키지 직접 동적 import는 네임스페이스 전체 보존으로 트리셰이킹 무력화(139→465KB) → **선별 재수출 파사드(`sentryClient.ts`) 경유**, ② 파사드가 자체 실행 코드 없는 순수 재수출이라 Rollup이 공유 청크로 접어 SDK 정적 엣지가 재생성 → **manualChunks로 파사드를 sentry 청크에 강제 배치**. setSentryUser는 로드 전 호출 시 큐잉 후 init 직후 적용, captureError는 initSentry 미호출 경로(비로그인)에서 기존과 동일하게 콘솔 출력만. 비로그인 정적 클로저 926KB에서 Sentry 제외 실측 확인 |
| **image-compression 동적화** | 공개 페이지(/apply)의 `useOrgApplication`이 browser-image-compression(51KB)을 정적 유입 → 압축 시점 동적 import로 전환 |
| **superAdmin 대시보드 스캔 방어** | `loadFuelHipassStats`·`loadNotificationStats`가 orgFilterId를 무시하고 fuelLogs·hipassCharges·notifications 30일치를 **전 테넌트·무제한 getDocs** — ① 기관 필터 선택 시 캐시 문서(`dashboardStats_{orgId}`)와 동일 규약으로 조직 스코프 적용(집계 쿼리 포함, 필터 선택에도 전체 수치가 나오던 스코핑 불일치 수정), ② 일별 차트 원본 조회에 5,000건 상한 + 도달 시 console.warn(Phase 71 내보내기 관용구 재사용). notifications `organizationId+createdAt` 복합 인덱스 추가 |
| **레거시 집계 서비스 삭제** | `services/statistics/dailyAggregation.ts` — 라이브 경로(`handlers/scheduled/dailyAggregation.ts`)와 별개로 남아 있던 구버전(날짜 필터 주석 처리 → org별 전 이력 스캔, `amount`/`toll` 불일치 필드 합산). 프로덕션 import 0건 확인 후 전용 테스트와 함께 삭제 |
| **requireSuperAdmin 가드 단일화** | 10개 callable에 인라인 복붙돼 있던 superAdmin 가드(에러 메시지 3변형)를 `utils/helpers.ts`의 헬퍼로 통일 — `asserts` 시그니처로 통과 후 `request.auth` non-null 좁힘, 제네릭으로 `request.data` 타입 보존. 권한 정책 변경 시 1곳만 수정 |
| **Gmail mailer 공통화** | `createTransporter` 5중복(승인/반려 이메일·피드백 답변·신규 신청 알림·verifyHelpers)을 `core/mailer.ts`(createGmailTransporter·isGmailConfigured·systemMailFrom)로 단일화 |
| **알림톡 수동발송 쌍 공통화** | 승인/반려 수동발송의 orgId 검증→기관 로드→수신자 추출 반복(~20줄×2)을 `services/alimtalk/manualSendHelpers.ts`로 추출 |
| **시각 포맷 유틸 재사용** | `formatTimestampTime`에 hour12 옵션·Date 입력 지원 추가(옵션 미지정 시 기존 표기 무변경) 후 주유/하이패스 관리 화면·엑셀 내보내기의 인라인 7줄 블록 4곳을 1줄 호출로 치환. 탐색 보고의 "출력 동일" 주장은 실측으로 반증(기본 "PM 02:30" vs h12=false "14:30")되어 옵션 방식 채택. 단위 테스트 2건 보강 |
| **검증** | 프론트·functions lint/tsc 통과, build 2,918KB(예산 내), functions 테스트 21스위트 207건·프론트 전체 단위 테스트 통과 |
| **보류(후속 후보)** | lightEntry 경량 AuthProvider 분리(비로그인 클로저에서 Firestore SDK 369KB 제외 가능하나 인증 핵심 훅 분기 리스크 커서 보류), 주유↔하이패스 관리 목록 UI 공용화(시각 회귀 리스크), wrapCallableHandler 22개 callable 전면 채택, 월간 집계 문서 프로듀서/컨슈머 스키마 불일치 의혹 검증, check-bundle-size 초기 로드 전용 예산 추가 |

### Phase 78: 버그 수정 — admin 분석 대시보드 집계 스키마 불일치 (프로듀서↔소비자) 🐛 ✅

> 2026-07-03, Phase 77 후속 검증 중 발견한 확정 버그 수정. 야간 배치 프로듀서(`runDailyAggregation`)와 프론트 소비자(`useAnalytics`)의 `orgStats/{orgId}/monthly` 문서 스키마가 필드명 수준에서 어긋나, admin 분석 대시보드가 2026-06-10(f75f2f6)부터 ~3.5주간 월별 추이·비용 추이·히트맵·총 운행 등이 전부 0/빈 값으로 표시되던 것을 소비자 변환 계층으로 수정.

| 항목 | 내용 |
|------|------|
| **원인 확정** | 프로듀서는 `monthlyTotal.count`·`costStats.fuelCost`·`heatmap`(요일→시간 중첩객체)·`driverStats[uid]`·`vehicleStats[vehId]`를 쓰는데, 소비자는 평탄 `totalLogs`·`fuelCost`·`heatmapData`(배열)를 읽고 [statistics.ts]의 무변환 `as MonthlyStat` 캐스팅이 이를 컴파일러로부터 가림. git 이력상 평탄 스키마 프로듀서는 존재한 적 없어(프로듀서·소비자 동일 커밋 신규 생성, 이후 프로듀서만 존재) 모든 프로덕션 문서가 중첩 → 확정 버그 |
| **수정 방향 — 소비자 리맵 (백필 불필요)** | 프로듀서가 야간 배치·비용 최적화된 정식 writer이므로 소비자를 정렬. `mapMonthlyDoc(monthKey, raw)` 순수함수를 신설해 `getMonthlyStats`에서 프로듀서 원시 스키마 → 평탄 `MonthlyStat` 변환: 중첩 total/cost 평탄화, heatmap 중첩객체 → `{dayIdx,hour,count}` 배열, driverStats/vehicleStats는 프로듀서 키(uid/vehId) 보존 + name 유지 |
| **소비자 조인 정렬** | `useAnalytics` — driverComparison은 `dStat.name`으로 그룹화(기존 UID 노출 수정), vehicleUtilization·fuelEfficiency·maintenanceCostAnalysis는 `v.id`(=vehId) 기준 매칭으로 통일(기존 표시명 매칭은 displayName 없는 차량에서 어긋남) |
| **복구 범위** | 월별 추이·비용 추이·히트맵·차량 가동률·운전자 비교·총 운행 복구. 차량별 연비·정비비·이상탐지는 프로듀서가 애초에 산출하지 않는 필드라 빈 상태 유지(0-채움으로 NaN·오해소지 테이블 없이 정직한 빈 상태로 귀결) — 프로듀서 집계 확장은 별도 후속 |
| **요일 규약 검증** | 프로듀서 `getDay()`(0=일)·변환 `Number(dayKey)`·소비자 `DAY_NAMES[0]='일'`·`HeatmapGrid` 4개 레이어 모두 0=일요일로 정렬 확인(off-by-one 없음) |
| **잠재 지뢰 선제 제거** | fuelEfficiency·maintenanceCostAnalysis가 vehicleStats를 이름 키로 가정하던 것을 vehId 키 기준으로 정렬 — 현재는 해당 필드가 0이라 무해하나, 향후 프로듀서가 차량별 비용을 채우면 동일 조인 버그 재발할 지점을 선제 봉합(현재 동작 변화 0) |
| **검증** | 신규 `mapMonthlyDoc` 단위 테스트 5건(필드별 1:1 매핑·heatmap 펼침·누락 문서 안전성). lint·tsc·build(2,918KB) 통과, 프론트 테스트 463건 통과. 적대적 리뷰로 4개 핵심 조인(요일·uid/name·vehId·0-채움 안전성) 정합성 교차 확인 |
| **후속 후보** | 프로듀서(`runDailyAggregation`)에 차량별 연비(totalDist/totalCost)·정비비(maintenanceCost/Count)·이상탐지(주말/심야/장거리) 집계 추가 시 연비·정비비·이상탐지 카드까지 복구(과거 월은 재집계 전까지 빈 값) |

### Phase 79: 프로듀서 확장 — 분석 집계 필드명 버그 3건 수정 + 차량별 연비·정비비·이상탐지 산출 📊 ✅

> 2026-07-03, Phase 78 후속. 소비자(useAnalytics)를 프로듀서에 맞춘 Phase 78에 이어, 이번엔 프로듀서(`runDailyAggregation`) 자체의 필드명 버그를 고치고 소비자가 이미 읽도록 준비된 미산출 필드(차량별 연비·정비비, 이상탐지)를 실제로 채웠다. Phase 78+79로 admin 분석 대시보드 전 카드가 복구된다(당월 기준, 과거 월은 재집계 필요).

| 항목 | 내용 |
|------|------|
| **프로듀서 필드명 버그 3건** | ① 운전자 식별자를 `data.uid \|\| data.driverId`(둘 다 없음)로 읽어 **driverStats가 항상 비어** 있던 것을 `data.driverUid`로 수정 → 운전자 비교 복구. ② 주유비를 `data.amount \|\| data.cost`(둘 다 없음)로 읽어 **costStats.fuelCost가 항상 0**이던 것을 `data.fuelCost`로 수정 → 비용 추이·종합 운영비 주유비 복구. (하이패스 `chargeAmount`·정비 `cost`는 정상이었음) |
| **차량별 연비 산출** | vehicleStats에 `distance`(운행일지 주행거리 누적)·`fuelCost`(fuelLogs 차량별 합) 추가 → 소비자 fuelEfficiency의 km당 연료비 계산 가능 |
| **차량별 정비비 산출** | vehicleStats에 `maintenanceCost`·`maintenanceCount`·`lastMaintenanceDate`(maintenanceRecords 차량별 집계) 추가. 운행 없이 정비만 있는 차량도 `ensureVehicle`로 엔트리 보장 → 정비비 표 누락 방지 |
| **이상탐지 산출** | 월 단위 `anomalies { weekend, night, overDrive }` 추가 — 죽은 `detectAnomalies`의 정의 준수(주말=일/토 로그 수, 심야=22~06시 로그 수, overDrive=운전자×일자 200km 초과 버킷 수). KST 변환(`toKSTDate`)으로 요일·시각 판정, 히트맵과 동일 시간 기준 |
| **2개월 재집계 리팩토** | 기존 당월만 집계하던 것을 `aggregateOrgMonth(orgId, win, userMap, vehicleMap)` 추출 + `runDailyAggregation(recentMonths=2)`로 당월+전월 재집계 — 지각·소급 입력(retroactive) 반영. 유저·차량 메타는 기관당 1회 로드해 월 루프에서 재사용(추가 읽기 최소화). recentMonths 인자로 과거 월 백필 가능 |
| **소비자 매핑 정렬** | `mapMonthlyDoc`이 프로듀서 신규 필드(vehicleStats.distance→totalDist, fuelCost→totalCost, maintenance*, anomalies)를 평탄 MonthlyStat으로 매핑. 구버전 문서(신규 필드 없음)는 0/빈 값으로 안전 폴백 |
| **검증** | functions tsc·lint 통과, 신규 프로듀서 테스트 6건(필드명 버그 회귀 방지 2건 포함)·매핑 테스트 6건 통과. 프론트 tsc·lint·build·전체 테스트 통과 |
| **배포 후 유의** | orgStats/monthly는 야간 배치(`runDailyAggregation`)만 기록하며 배포 직후엔 당월+전월만 갱신된다. 분석 대시보드 기본 6개월 창의 과거 월을 즉시 교정하려면 `runDailyAggregation(6)` 형태의 **1회 백필**을 의도적으로 트리거해야 함(별도 후속 → Phase 80). 2개월 재집계로 기관당 야간 읽기 쿼리 약 6→10개로 증가(1일 1회, 허용 범위) |
| **후속(CI 안정화)** | Phase 77~79 배포 시 인증 E2E(`authed-offlineSync`)가 CI에서 **맨 처음** 실행돼 vite dev 서버의 온디맨드 콜드 컴파일(auth+라우팅+레이아웃 전체 그래프)을 홀로 부담, 로그인→리다이렉트가 25s를 초과해 2회 연속 실패(로컬은 앞선 테스트가 서버를 예열해 통과). 제품 버그가 아닌 콜드스타트 타이밍으로 확인(로컬 4/4 그린) → `playwright.emulator.config.ts`에 `retries: process.env.CI ? 2 : 0` 추가로 흡수. 게이트 구조(Deploy가 CI 성공 종속)는 두 실패 동안 배포를 정확히 차단 |

### Phase 80: 월별 집계 백필 콜러블 — 과거 월 소급 재집계 트리거 🔁 ✅

> 2026-07-03, Phase 79 후속. 야간 배치(`runDailyAggregation`)가 당월+전월만 갱신하므로, Phase 78~79의 집계 수정을 분석 대시보드 기본 창(6개월) 전체에 즉시 반영하기 위한 superAdmin 전용 일회성 백필 트리거를 추가했다.

| 항목 | 내용 |
|------|------|
| **backfillMonthlyStats 콜러블** | `handlers/callable/backfillMonthlyStats.ts` 신설(asia-northeast3, 540s, 512MiB) — `requireSuperAdmin` 가드 후 `runDailyAggregation(months)` 호출. `months`는 1~24로 클램프(기본 6). `set(merge)`라 멱등 — 타임아웃 시 재호출 안전. index.ts 등록 |
| **트리거 방식** | 영구 UI 없이 superAdmin이 로그인된 상태에서 1회 호출. 일회성 데이터 교정이므로 전용 화면은 과설계로 판단. 단 Vite 프로덕션 빌드의 콘솔에선 `import('firebase/functions')` 같은 bare 모듈 경로가 해석되지 않으므로, localStorage의 세션(`firebase:authUser:*`)에서 refreshToken을 꺼내 신선한 ID 토큰을 발급받아 콜러블 HTTPS 엔드포인트에 직접 `fetch`하는 스니펫으로 호출(App Check 미강제) |
| **검증** | functions tsc·lint 통과, 콜러블 테스트 4건(권한 가드 2·months 클램프·기본값). 집계 로직 자체는 Phase 79의 dailyAggregation 테스트가 커버(여기선 runDailyAggregation mock) |
| **후속(운영) → Phase 81에서 결정적 결함 발견** | 배포 후 백필을 첫 실행하니 `durationMs:1131`(약 1초)로 "성공" 반환 — 195개 기관 재집계엔 비현실적으로 빨라 로그 확인 → 비용 쿼리 인덱스 오류로 **조용히 실패**하고 있었음이 드러남(→ Phase 81). "성공 표시"만 믿지 않고 소요 시간의 이상 신호를 검증한 것이 근본 원인 포착으로 이어짐 |

### Phase 81: 월별 집계 근본 원인 수정 — 비용 쿼리 인덱스 방향·기관별 오류 격리 🩹 ✅

> 2026-07-03, Phase 80 백필 실행 중 로그로 드러난 **더 앞단의 근본 원인** 수정. Phase 78~79는 집계 문서의 스키마·필드명을 고쳤지만, 실은 프로듀서가 그보다 먼저 비용 쿼리에서 예외로 죽어 **orgStats/monthly 문서를 아예 못 쓰고 있었다**(분석 대시보드가 0으로 보인 최심층 원인). 야간 배치가 오류를 조용히 삼켜 그동안 무증상이었다.

| 항목 | 내용 |
|------|------|
| **근본 원인** | 프로듀서의 fuelLogs/hipassCharges/maintenanceRecords 비용 쿼리가 `orderBy` 없는 `date` 범위 필터라 Firestore가 `(organizationId, date ASC)` 인덱스를 요구 → 기존 인덱스는 `date DESC`뿐이라 `FAILED_PRECONDITION` → aggregateOrgMonth가 첫 기관에서 예외 → 최상위 try/catch가 삼키고 ~1s 만에 종료(아무 문서도 못 씀). 백필 콜러블은 그럼에도 `success:true` 반환 |
| **쿼리 수정** | 세 비용 쿼리에 `.orderBy("date","desc")` 추가 → 기존 `(organizationId ASC, date DESC)` 복합 인덱스를 그대로 사용(정렬은 집계 결과 무관). **새 인덱스 빌드 대기 없이** 함수 배포만으로 즉시 해결 |
| **기관별 오류 격리** | `runDailyAggregation` 최상위 try/catch(첫 실패 시 전체 중단·조용히 삼킴)를 **기관별 try/catch**로 교체 — 한 기관 실패가 나머지를 막지 않음. 치명적 오류(기관 목록 조회 실패 등)만 상위로 전파 |
| **조용한 실패 방지** | `runDailyAggregation`이 `{orgs, processed, errors, months}` 요약 반환. 백필 콜러블이 이를 반환하고 `errors>0`이면 `success:false` → 향후 부분 실패가 성공으로 위장되지 않음 |
| **테스트 한계 인지** | Phase 79 프로듀서 테스트는 firestore를 mock해 인덱스 요구를 재현 못 함. 에뮬레이터도 복합 인덱스를 강제하지 않아 이 결함은 프로덕션에서만 발현 — 로그 확인이 유일한 검증 경로였음. 테스트에 orderBy mock·요약 반환·부분 실패 케이스 추가 |
| **검증** | functions tsc·lint·테스트(프로듀서 6 + 백필 5) 통과, CI→Deploy 성공. superAdmin이 백필 재실행 → `{success:true, orgs:195, processed:195, errors:0, durationMs:105473}` — 직전 조용한 실패는 1,131ms로 즉시 종료했으나 이번엔 **약 105초** 소요 = 195개 기관 6개월치가 실제로 집계·기록됐음을 시간 자체가 입증. 이후 야간 배치가 당월+전월을 계속 유지 |
| **결과** | Phase 78→79→81로 admin 분석 대시보드 전 카드(월별 추이·비용 추이·히트맵·차량 가동률·운전자 비교·차량별 연비·정비비·이상탐지)가 6개월 창 전체에서 복구. 근본 원인은 스키마·필드가 아니라 프로듀서가 인덱스 오류로 문서를 아예 못 쓰던 것이었고, 세 Phase가 각각 소비자 변환·필드/산출·쿼리 인덱스 계층을 순서대로 교정 |
