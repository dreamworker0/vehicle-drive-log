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
> 코드 분리 과제(1~3)와 **Functions 런타임 메이저 이관**(2026-09-06 완료)까지 모두 처리됐다.
> 현재 미착수 항목은 없다.

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

## 별도 트랙: Functions 런타임 메이저 이관 — 완료 (2026-09-06, PR #342)

`firebase-admin` 13→14, `firebase-functions` 6→7, `@types/express` 4→5로 올렸고
dependabot ignore 두 항목도 제거했다. **프로덕션 소스는 한 줄도 바뀌지 않았다** —
의존성과 jest 설정뿐이다. 자세한 경위는
[Phase 216](구현이력/트랙B_Phase212부터.md)과
[계획서](2026-09-06-Functions런타임이관-계획서.md).

이 문서의 이전 판(2026-08-05 추정 "8개 파일 22건")이 왜 틀렸는지는 남겨 둔다 —
**측정 없이 적은 숫자가 13개월 동안 계획의 근거로 쓰였다.**

| 항목 | 이전 판 | 실측 |
|---|---|---|
| `admin.firestore` 네임스페이스 | 4건 | **0건** — 이미 해소돼 있었다 |
| 타입 오류 | 8개 파일 22건 | **3건**, 코드가 아니라 의존성 문제 |
| `firebase-functions-test` | 언급 없음 | **차단 원인** — 미사용 유령 의존성 |
| Jest × ESM `jose` | 언급 없음 | **진짜 과제** — 17 스위트 |

또 하나 정정한다. 이전 판과 `createAuthenticatedProxy.test.ts` 머리말이
"`@types/express` 5에서 `Request`/`Response` named export가 사라진다"고 적었는데
**사실이 아니다** — 5에도 `interface Response`가 있다. 실제로 났던 TS2345는
트리에 express 타입이 **두 벌** 공존해(우리 4 vs functions 7이 번들한 5)
`sendfile` 유무로 갈린 것이었고, 한 벌로 맞추자 소스 수정 없이 사라졌다.

### 남은 커플링 (해소되지 않았다)

- `firebase-functions@7`의 peer가 `firebase-admin ^11 || ^12 || ^13 || ^14`라
  **미래의 admin 15 단독 PR은 PR #116과 똑같이 ERESOLVE로 죽는다.**
- Jest에서 `jose`를 변환하려고 들인 `@babel/core`·`@babel/preset-env`는
  **8 메이저에서 한 묶음**이다(preset-env 7의 peer가 `@babel/core ^7`만 받는다).
  둘 다 [.github/dependabot.yml](../.github/dependabot.yml)에 주석으로 남겼다.

---

## 공통 가이드

- 한 번에 하나의 파일만, 작은 단위로 추출하고 매번 `type-check` + `test` + (관련 시) `build`로 검증한다.
- 검증은 Node 22 강제: `fnm exec --using=22 npm.cmd ...` (셸 기본 Node가 24).
- 추출 대상이 순수 함수면 우선적으로 단위 테스트를 먼저 작성한 뒤 추출한다(동작 고정).
- UI 컴포넌트 분리는 다크모드/터치 타겟/접근성 회귀를 함께 점검한다.
