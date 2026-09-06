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

루트 `eslint.config.js`에서 `functions`를 통째로 ignore하던 것을 해제하고, Node 백엔드
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

> **2026-09-06 실측으로 전면 갱신.** 이전 판(2026-08-05 기준 "8개 파일 22건")은 두 군데가
> 틀렸다 — 최대 난관으로 적혀 있던 두 항목은 **이미 해소됐고**, 정작 막고 있는 것 둘은
> 적혀 있지 않았다. 아래는 두 메이저를 실제로 설치해 측정한 결과다.
>
> 측정 방법: 브랜치에서 `npm install firebase-admin@^14 firebase-functions@^7`,
> `npm run type-check:functions`, `npm --prefix functions run test`. 측정 후 원복했다.

`firebase-admin` 13→14와 `firebase-functions` 6→7은 **함께 올려야 하는 한 묶음**이다.
functions 6의 peer가 `firebase-admin ^11 || ^12 || ^13`이라 admin 14 단독 상향은 `npm ci`가
ERESOLVE로 실패하고(PR #116), functions 7은 peer에 `^14`를 포함하므로 순서가 강제된다.
dependabot은 두 메이저를 ignore에 등록해 보류 중이며
([.github/dependabot.yml](../.github/dependabot.yml)), 이관 완료 시 **두 항목을 함께** 제거한다.

### 해소된 것 (더 이상 과제가 아님)

- **`admin.firestore` 네임스페이스 API — 0건.** 이전 판은 3개 파일에 4건이 남았다고
  적었으나, `functions/src`·`scripts` 전체에 `admin.firestore`·`import * as admin` 사용이
  없다. 다른 작업에 딸려 정리된 것으로 보인다.
- **타입 오류 — 22건이 아니라 3건이고, 그 3건도 의존성 정렬로 사라진다.**
  `slackEvents.ts`·`slackOauthCallback.ts`·`createAuthenticatedProxy.ts`에서 나는 TS2345는
  코드 문제가 아니라 **트리에 express 타입이 두 개 있어서** 난다 — 우리가 명시한
  `@types/express` 4와 firebase-functions 7이 번들한 5가 `sendfile` 유무로 갈린다.
  `@types/express`를 5로 올리면 **type-check 0건**이 된다(실측).
  즉 열려 있는 PR #287은 틀린 게 아니라 **순서만 어긋난** PR이다.

### 실제로 막고 있는 것

**(1) `firebase-functions-test`가 admin 14를 막는다 — 그런데 쓰지 않는 패키지다.**

peer가 `firebase-admin ^8 ~ ^13`이고 **최신이 3.5.0이라 올릴 수단이 없다.** 이 상태로는
`npm ci`가 ERESOLVE로 죽는다. 그런데 저장소 전체에서 이 패키지를 import하는 코드가
**한 줄도 없다**(`package.json`·`package-lock.json`에만 존재). 제거로 해소된다.

**(2) `jose`가 ESM 전용이라 Jest가 로드에 실패한다 — 이것이 진짜 과제다.**

```
firebase-admin@14 → jwks-rsa@4.1.0 → jose@6.2.12
  exports["."].default → ./dist/webapi/index.js   (CJS 빌드 없음)
```

우리 Jest는 ts-jest CommonJS 구성이라 `require()`가 불가능하고,
`firebase-admin/auth`를 타고 들어가는 **모든 테스트가 로드 단계에서 죽는다 —
17개 스위트, 발생 44회**(`Must use import to load ES Module`). 프로덕션 런타임은
영향이 없다. **테스트 인프라만의 문제**다.

- 배포 대상 Node 22는 ESM을 로드할 수 있고, 실제 실행 경로는 firebase-admin이 처리한다.
- `functions/package.json`의 jest 설정에는 `transform`이 `^.+\.tsx?$` 하나뿐이라
  `node_modules`의 JS는 변환 대상이 아니다.
- 참고: `joinOrganization.ts:182`가 이미 `await import("firebase-admin/auth")` 형태를
  쓰고 있다. 다만 `module: "commonjs"` 하에서는 이것도 `require`로 내려가므로,
  지연 로딩이 통하는 이유는 "테스트가 그 경로를 실행하지 않아서"이지 ESM을
  제대로 로드해서가 아니다 — 해법을 고를 때 이 차이를 혼동하지 말 것.

### 위험 (변하지 않음)

인증 프록시(`createAuthenticatedProxy`)는 `holidayProxy`·`tmapProxy`의 공통 관문이라
배포 즉시 프로덕션에 반영된다. 커버리지가 0%였으므로 이관 전제로
`functions/src/__tests__/createAuthenticatedProxy.test.ts`를 먼저 붙였다(401·429·uid 전달·
rate limit 키가 IP가 아니라 uid라는 점까지 고정). 이관 시 에뮬레이터에서 Slack 웹훅
경로를 함께 확인한다.

**계획서**: [2026-09-06-Functions런타임이관-계획서.md](2026-09-06-Functions런타임이관-계획서.md)

---

## 공통 가이드

- 한 번에 하나의 파일만, 작은 단위로 추출하고 매번 `type-check` + `test` + (관련 시) `build`로 검증한다.
- 검증은 Node 22 강제: `fnm exec --using=22 npm.cmd ...` (셸 기본 Node가 24).
- 추출 대상이 순수 함수면 우선적으로 단위 테스트를 먼저 작성한 뒤 추출한다(동작 고정).
- UI 컴포넌트 분리는 다크모드/터치 타겟/접근성 회귀를 함께 점검한다.
