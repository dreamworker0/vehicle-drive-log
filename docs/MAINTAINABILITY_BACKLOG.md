# 유지보수성 개선 백로그

품질 평가에서 도출된 유지보수성 개선 후보를 기록한다. **새 기능이 아니라 기존 코드의
구조 개선**이며, 각 항목은 회귀 위험이 있으므로 충분한 테스트와 함께 별도 작업으로 진행한다.

> 1차 정리: `VehicleTimelineBar`의 예약 블록 위치 계산을 순수 함수
> `resolveReservationBlock`(`src/lib/timelineUtils.ts`)으로 분리 + 테스트.
>
> 2차 정리(안전 우선·단계적, 특성화 테스트 동반): 아래 1~3의 저~중위험 부분을 분리 완료.
>
> 3차 정리: **Settings 결재라인 섹션 추출**과 **Functions ESLint 도입**까지 완료.
> 코드 분리 과제(1~3)는 모두 처리되었다(아래 각 항목 "완료" 참고).
>
> 미착수 과제는 **Functions 런타임 메이저 이관** 한 건이다(아래 별도 트랙).

---

## 1. `src/components/admin/Settings.tsx` — 대부분 분리 완료

상태(`form`/`org`)와 저장(`handleSave`)은 `useSettings` 훅이 계속 소유하고, 표시 전용
섹션만 분리(props-down)했다.

- **완료**:
  - `settings/OrgInfoSection.tsx` (기관 정보 폼) + 테스트
  - `settings/ReservationApprovalSection.tsx` (예약 승인 토글) + 테스트
  - `settings/AccountSection.tsx` (내 계정/푸시 — 전역 훅 직접 사용)
  - `hooks/useSettingsModals.ts` (모달 4종 on/off 상태) + 테스트
  - `settings/ApprovalLineSection.tsx` (결재 라인: PDF 결재란 토글 + 결재자 목록 편집) + 특성화 테스트.
    `form`은 부모(useSettings)가 계속 소유하고 `setForm`/`handleSave`를 props로 전달(동작 보존).
- **결과**: `Settings.tsx`는 기관 관리/앱 정보/계정/해지 섹션을 조립만 하는 컨테이너로 축소됨.
- **주의**: 공휴일(`HolidayManager`)·해지(`WithdrawOrgModal`)는 이미 분리됨. 다크모드(D8)·터치 타겟(D16) 유지.

## 2. `src/components/common/VehicleTimelineBar.tsx` — 분리 완료

- **완료**:
  - 예약 블록 left/width 계산 → `resolveReservationBlock` 순수 함수 + 테스트(1차).
  - 차량 1대 행 → `VehicleTimelineRow.tsx` 컴포넌트로 분리 + RTL 테스트.
  - 아코디언 예약 상세 → `ReservationAccordion.tsx` 컴포넌트로 분리 + RTL 테스트.
  - 부모는 `useTimelineDrag` 상태·전역 이벤트만 보유, ref는 `barRefCallback` prop으로 전달.
- **남은 후보(선택)**: prop 수가 많아지면 드래그 관련 값(`dragState`/`dragOverlay`/`barRefCallback`)을
  Context로 묶는 안도 있으나, 현 규모에선 과하므로 보류.

## 3. `functions/src/services/statistics/computeDashboardStats.ts` — 분리 완료

- **완료**: "5.5 예약 집계" 블록을 `dashboardSections.ts`의 순수 함수
  `computeReservationStats(reservationDocs, thirtyDaysAgo, todayStart, orgFilterId)`로 추출
  (반환은 `ReservationStatsResult` 인터페이스). 골든/특성화 단위 테스트
  `functions/src/__tests__/computeReservationStats.test.ts` 추가.
- **참고**: 반환 8개 필드는 `dashboardTimeSeries` 조립부에서 그대로 사용되며 형태 불일치 시 회귀.
  현재 테스트가 8개 키 존재 + 분류/필터/중복제거를 고정한다.

---

## 별도 트랙: Functions ESLint 도입 — 완료

루트 `eslint.config.js`에서 `functions`를 통째로 ignore하던 것을 해제하고, Node/ESM 백엔드
전용 블록을 추가했다(`npm run lint`가 functions까지 커버, `npm run lint:functions`로 단독 실행).

- **규칙 방침(프로젝트 규모 적합)**: `typescript-eslint` recommended 기반.
- **실제 버그성 규칙은 error**: `no-unused-vars`(rest-sibling omit 예외), `prefer-const`,
  `no-useless-escape` 등. 도입 시 소스 위반(미사용 import/변수, 불필요 escape 등)을 정리했다.
- **테스트·일회성 스크립트 완화**: Jest 모킹의 `Function` 타입·CJS `require`·`any`는 정당하므로
  `no-unsafe-function-type`/`no-require-imports`/`no-undef`/`no-explicit-any`를 해당 파일에 한해 off.
- **`any` 제거 완료**: 소스의 `no-explicit-any` ~33곳을 의미 있는 타입으로 교정했다 —
  Firestore 데이터는 `FirebaseFirestore.DocumentData`, 함수 경계 캐스트는 `as Parameters<typeof fn>[n]`,
  OAuth2 클라이언트는 `InstanceType<typeof google.auth.OAuth2>`, Storage 버킷은
  `ReturnType<...getStorage().bucket>`, 외부 API 응답은 최소 응답 인터페이스로 정의.
  현재 `npm run lint`는 functions 포함 **0 errors / 0 warnings**.

---

## 별도 트랙: Functions 런타임 메이저 이관 (firebase-admin 14 · firebase-functions 7) — 미착수

`firebase-admin` 13→14와 `firebase-functions` 6→7은 **함께 올려야 하는 한 묶음**이다.
functions 6의 peer가 `firebase-admin ^11 || ^12 || ^13`이라 admin 14 단독 상향은 `npm ci`가
ERESOLVE로 실패하고(PR #116), functions 7은 peer에 `^14`를 포함하므로 상향 순서가 강제된다.
둘을 함께 설치해 검증하면 `npm run type-check:functions`가 **8개 파일에서 22건** 실패했다
(2026-08-05 실측). 이 수치는 `updateDriveLogStats.ts` 삭제 **이전** 값이므로, 그 파일이
들고 있던 8건이 빠진 현재는 더 적다 — 정확한 수는 두 메이저를 실제로 설치해 재측정해야 한다.
그래서 dependabot은 두 메이저를 ignore에 등록해 보류 중이며
([.github/dependabot.yml](../.github/dependabot.yml)), 이관 완료 시 **두 항목을 함께** 제거한다.

- **(1) `admin.firestore` 네임스페이스 API 제거 (12건 → 4건)** — firebase-admin 14가 네임스페이스
  접근을 없앴다. 모듈러 API로 이관한다: `getFirestore()`·`FieldValue`를
  `firebase-admin/firestore`에서 직접 import.
  - ~~`services/driveLog/updateDriveLogStats.ts` (8건 — 가장 큼)~~ → **파일 삭제로 해소**.
    죽은 코드였다: `index.ts`에 export가 없어 배포된 적이 없고, 트리거 경로
    `organizations/{orgId}/driveLogs/{logId}`는 데이터 모델에 없으며(`driveLogs`는 최상위),
    쓰는 대상 `organizations/{orgId}/monthlyStats`를 읽는 코드도 없었다. 실제 집계는
    `syncDriveLogKm` → `updateAggregatedStats`가 담당한다. 재발 방지로
    `check:functions-catalog`에 **고아 함수 파일 검사**를 추가했다(정의했으면 index.ts에 등록).
  - 남은 것: `scripts/cleanDuplicateCalendars.ts` (2건),
    `handlers/scheduled/verifyMileageConsistency.ts` (1건),
    `handlers/https/submitPublicFeedback.ts` (1건)
- **(2) express 타입 5 계열 전환 (8건)** — firebase-functions 7이 번들하는 `@types/express`가
  5로 올라가며 `Request`/`Response` named export가 사라졌다.
  - `utils/helpers.ts`, `utils/createAuthenticatedProxy.ts`,
    `handlers/https/slackEvents.ts`, `handlers/https/slackOauthCallback.ts` (각 2건)
- **주의**: 인증 프록시(`createAuthenticatedProxy`)는 `holidayProxy`·`tmapProxy`의 공통 관문이라
  배포 즉시 프로덕션에 반영된다. 커버리지가 0%였으므로 이관 전제로
  `functions/src/__tests__/createAuthenticatedProxy.test.ts`를 먼저 붙였다(401·429·uid 전달·
  rate limit 키가 IP가 아니라 uid라는 점까지 고정). 이관 시 에뮬레이터에서 Slack 웹훅
  경로를 함께 확인한다.
  - 과거 이 항목이 "집계 트리거(`updateDriveLogStats`)" 위험을 함께 들고 있었으나, 그 함수는
    배포되지 않는 죽은 코드였다(위 (1) 참고). 이관의 최대 난관으로 계산돼 있던 것이
    실제로는 위험이 아니었다 — 남은 위험은 인증 프록시와 express 타입뿐이다.

---

## 공통 가이드

- 한 번에 하나의 파일만, 작은 단위로 추출하고 매번 `type-check` + `test` + (관련 시) `build`로 검증한다.
- 검증은 Node 22 강제: `fnm exec --using=22 npm.cmd ...` (셸 기본 Node가 24).
- 추출 대상이 순수 함수면 우선적으로 단위 테스트를 먼저 작성한 뒤 추출한다(동작 고정).
- UI 컴포넌트 분리는 다크모드/터치 타겟/접근성 회귀를 함께 점검한다.
