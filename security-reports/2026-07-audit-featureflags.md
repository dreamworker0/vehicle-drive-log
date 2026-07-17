# 2026-07 기능 사용 설정 보안·정합성 감사

- 감사일: 2026-07-17
- 기준 커밋: `e426eb0`
- 집중 변경 커밋: `372c436` (`feat: 기관별 기능 사용 on/off 설정 및 입력 방식 선택`)
- 범위: 기관 기능 플래그, 운행일지·차량관리 게이트, Firestore Rules, 관련 Cloud Functions
- 판정 기준: 코드 경로와 기존 테스트 기대값을 함께 대조했다. 실행 가능한 Firebase CLI가 로컬에 없어
  `npm run test:rules`는 시작하지 못했으며, 외부 `firebase-tools` 일회성 실행도 보안 승인 단계에서 거부됐다.

## 요약

| ID | 심각도 | 상태 | 요약 |
|---|---|---|---|
| F-01 | HIGH | CONFIRMED | `driverUid`가 존재·기관·활성 상태 검증 없이 생성·변경된다 |
| F-02 | HIGH | CONFIRMED | 직접 운행일지 쓰기로 제한 차량과 교차 기관 차량 참조를 우회할 수 있다 |
| F-03 | MED | CONFIRMED | 주요 기능 OFF가 UI에만 적용되고 Rules 쓰기 정책에는 반영되지 않는다 |
| F-04 | MED | CONFIRMED | Google 캘린더 OFF 후에도 기존 차량의 양방향 동기화가 계속된다 |
| F-05 | MED | CONFIRMED | 여러 기능 토글의 즉시 저장이 경쟁하면 먼저 누른 변경이 유실된다 |
| F-06 | LOW | PLAUSIBLE | 슈퍼관리자 전환 시 이전 `orgDeleted` 상태가 남을 수 있다 |

조치 현황(2026-07-17 운영자 결정):

- **F-03·F-04·F-05는 수정** — F-04·F-05는 PR로 반영 완료, F-03은 후속 과제로 대기(저볼륨 컬렉션이라 org get() 1회로 강제 가능).
- **F-01·F-02는 Rules 강제 대신 "잔여 위험 수용"으로 문서화** — 상세 근거·재검토 트리거는 각 항목의 "조치 결정" 참고.
- **F-06은 리포트에만** 남긴다.

## 발견 항목

### F-01 — 임의 `driverUid` 지정 허용

- 파일: `firestore.rules:150-171`, `tests/firestore-rules.test.ts:403-460`
- 심각도: **HIGH**
- 검증 상태: **CONFIRMED**
- 요약: 운행일지 생성은 `createdByUid == request.auth.uid`만 확인한다. `driverUid`가 같은 기관의 존재하는
  활성 사용자라는 조건은 없으며, 작성자와 관리자는 수정 시 `driverUid`를 임의 문자열로 바꿀 수 있다.
  현재 Rules 테스트도 `user_X`, `user_Y`, `user_Z` 문서를 만들지 않은 채 해당 UID 지정 성공을 기대한다.
- 재현 시나리오(입력 → 잘못된 결과): org-A 직원 `user_A`가 `organizationId: 'org-A'`,
  `createdByUid: 'user_A'`, `driverUid: 'org-B-user'` 또는 `driverUid: 'disabled-user'`로 `driveLogs`를
  생성한다 → Rules가 허용하고 타 기관·비활성·존재하지 않는 UID가 운전자 통계와 운행 책임자로 기록된다.
- 제안 수정: Rules에 운전자 문서 존재, `organizationId` 일치, `status != 'disabled'` 검증을 추가한다.
  생성 시 항상 검사하고, 수정은 `driverUid` 변경 시 검사한다. 슈퍼관리자도 작성자 위조 예외만 유지하고
  지정 운전자의 기관·활성 조건은 동일하게 적용한다.
- **조치 결정(2026-07-17): 잔여 위험 수용 — Rules 강제하지 않음.** 근거:
  1. 완전 차단은 운행일지 생성 1건마다 `get(/users/$(driverUid))`가 필요하다. 운행일지 쓰기는 매 운행마다
     발생하므로 210개 기관 누적 읽기 비용이 크고, 의도적으로 지켜온 no-get 원칙(Phase 83)과 충돌한다.
  2. 영향은 **교차 테넌트 유출이 아니다.** 로그의 `organizationId`는 `newBelongsToMyOrg`로 작성자 기관에
     고정되며, `driverUid`만 자기 기관 안에서 오지정될 수 있다(통계·운행 책임자 라벨 오류).
  3. 정상 UI 경로는 이미 제약한다 — 운전자 후보를 org 멤버(지정 차량이면 `allowedUserIds` 교집합)로 필터
     (`src/hooks/useDriveLogForm.ts:110-116`). 잔여 위험은 **인증된 내부 사용자가 raw SDK 요청을 조작**하는
     경우로 한정된다.
  - 재검토 트리거: 오지정이 실제 운영 문제로 관측되면 → 운행일지 생성을 검증형 콜러블로 이관(오프라인 우선
    UX 트레이드오프 감수)하거나 정기 정합성 배치 검사를 도입한다.

### F-02 — 제한 차량 및 교차 기관 차량 참조 우회

- 파일: `firestore.rules:115-171`, `functions/src/handlers/callable/createReservationSafe.ts:59-75`,
  `src/lib/vehicleUtils.ts:24-38`
- 심각도: **HIGH**
- 검증 상태: **CONFIRMED**
- 요약: 예약 서버와 UI는 `allowedUserIds`를 역할과 무관하게 강제하지만, `driveLogs` Rules는 `vehicleId`의
  차량 문서를 전혀 읽지 않는다. 따라서 예약을 거치지 않는 직접 운행일지 쓰기에서는 제한 차량을 사용할 수
  있고, 자기 기관 운행일지가 타 기관 또는 존재하지 않는 차량 ID를 참조하는 것도 허용된다.
- 재현 시나리오(입력 → 잘못된 결과): org-A 차량 `v1`의 `allowedUserIds`가 `['user_B']`인 상태에서
  org-A 직원 `user_A`가 `organizationId: 'org-A'`, `vehicleId: 'v1'`, `createdByUid: 'user_A'`로 직접
  운행일지를 생성한다 → `createReservationSafe`는 같은 요청자를 거부하지만 `driveLogs` Rules는 허용한다.
  `vehicleId: 'org-B-vehicle'`로 바꿔도 운행일지 자체는 org-A 문서로 저장된다.
- 제안 수정: 운행일지 생성 시 차량 존재·기관 일치와 작성자/대표 운전자의 `allowedUserIds` 포함 여부를
  검증한다. 수정 시 `vehicleId`는 모든 비슈퍼관리자에게 불변으로 만들고, 관리자가 차량을 바꿔야 한다면
  새 차량의 기관·허용 목록을 검증하는 별도 정책으로 제한한다.
- **조치 결정(2026-07-17): 잔여 위험 수용 — Rules 강제하지 않음.** F-01과 동일한 트레이드오프다.
  완전 차단은 운행일지 생성 1건마다 `get(/vehicles/$(vehicleId))`가 필요해 no-get 원칙과 충돌하고, 영향은
  자기 기관 로그의 차량 참조 오지정에 그친다(교차 테넌트 유출 아님). 정상 UI는 차량 목록을 org 차량으로,
  지정 차량은 탑승 가능 사용자로 이미 제약하므로(예약 서버 `createReservationSafe` + `isVehicleRestrictedForUser`)
  잔여 위험은 raw SDK 요청 조작으로 한정된다. 재검토 트리거는 F-01과 동일(콜러블 이관 또는 정합성 배치 검사).

### F-03 — 기능 OFF가 Firestore 쓰기에 미반영

- 파일: `src/components/employee/FuelLogTab.tsx:20-30,71-101`,
  `src/components/employee/DriveLogForm.tsx:164-207`, `src/components/admin/AdminLayout.tsx:135-140,270-281`,
  `firestore.rules:135-171,234-275`, `tests/firestore-rules.test.ts:350-400`
- 심각도: **MED**
- 검증 상태: **CONFIRMED**
- 요약: `maintenanceEmployeeAccess`, `maintenanceEnabled`, `hipassEnabled`, `passengerEnabled`,
  `coDriverEnabled`, `driverSelectionEnabled`는 렌더링만 제어한다. Rules는 기관 문서의 기능 플래그를 읽지
  않는다. 특히 기존 Rules 테스트는 일반 직원의 정비 기록 생성·수정·삭제 성공을 고정하고 있어
  `maintenanceEmployeeAccess=false`의 “관리자 전용” 의미와 직접 충돌한다.
- 재현 시나리오(입력 → 잘못된 결과):
  - `maintenanceEmployeeAccess=false`인 org-A 직원이 `createdByUid`를 본인으로 하고
    `blockVehicle:false`인 `maintenanceRecords`를 직접 생성한다 → 관리자 전용 설정인데 쓰기가 성공한다.
  - `hipassEnabled=false`인 org-A 직원이 `hipassCharges`를 직접 생성하거나 자기 기관 카드 `balance`를
    갱신한다 → 숨겨진 기능의 비용·잔액 데이터가 변경된다.
  - `passengerEnabled=false` 또는 `coDriverEnabled=false`인데 해당 필드를 포함한 `driveLogs`를 생성한다
    → Rules가 필드를 검사하지 않아 비활성 기능 데이터가 저장된다.
  - `driverSelectionEnabled=false`인데 `driverUid != createdByUid`로 생성한다 → 대표 운전자 변경이 저장된다.
- 제안 수정: 미설정은 ON으로 보는 공통 Rules 헬퍼를 추가한다. 정비는 `maintenanceEnabled`와
  `maintenanceEmployeeAccess`를, 하이패스 카드·충전은 `hipassEnabled`를 강제한다. 운행일지는 기능 OFF일 때
  신규 기능 필드의 추가·변경을 거부하되, 기존 기록의 다른 필드 수정과 비활성 데이터 제거는 허용해
  레거시 문서가 잠기지 않게 한다.

### F-04 — 캘린더 OFF 후 기존 동기화 지속

- 파일: `src/components/admin/settings/FeatureToggleSection.tsx:33-43`,
  `functions/src/handlers/triggers/reservationTriggers.ts:19-38,194-270`,
  `functions/src/handlers/scheduled/calendarSchedule.ts:56-59,84-100,165-188`,
  `functions/src/handlers/callable/triggerOnDemandCalendarSync.ts:63-114`
- 심각도: **MED**
- 검증 상태: **CONFIRMED**
- 요약: `googleCalendarEnabled=false`는 차량 폼의 연결 입력만 숨긴다. 기존 차량의 `googleCalendarId`는
  보존되며, 예약 트리거·정기 역동기화·수동 동기화는 기관 플래그를 전혀 확인하지 않는다. 관리자가 기능을
  껐다고 인식한 뒤에도 외부 캘린더 쓰기와 캘린더→예약 생성이 계속된다.
- 재현 시나리오(입력 → 잘못된 결과): 캘린더가 연결된 `v1`을 둔 채 org-A가
  `googleCalendarEnabled:false`를 저장하고 새 예약을 만든다 → `onReservationCreated`가 기존
  `googleCalendarId`로 외부 이벤트를 계속 만든다. 다음 스케줄 실행에서는 외부 이벤트가 다시 앱 예약으로
  생성·수정된다.
- 제안 수정: Functions 공통 헬퍼로 기관의 `googleCalendarEnabled !== false`를 확인한다. 예약 트리거,
  스케줄러, on-demand callable 모두 같은 헬퍼를 사용하고 OFF 기관은 외부 API 호출과 역동기화 쓰기를
  건너뛴다. 미설정 기관은 계속 ON으로 처리한다.

### F-05 — 즉시 저장 토글의 lost update

- 파일: `src/hooks/useSettings.ts:155-194`, `src/components/admin/Settings.tsx:72-90`,
  `src/components/admin/settings/FeatureToggleSection.tsx:105-120`
- 심각도: **MED**
- 검증 상태: **CONFIRMED**
- 요약: 토글 클릭마다 현재 렌더의 `form` 전체와 한 필드 override를 합쳐 모든 설정 필드를 비동기로
  저장한다. 첫 저장이 끝나기 전에 두 번째 토글을 누르면 두 요청 모두 같은 이전 `form`을 기준으로 하며,
  나중에 도착한 요청이 앞선 변경을 되돌린다. `saving` 상태도 기능 토글을 잠그지 않는다.
- 재현 시나리오(입력 → 잘못된 결과): `hipassEnabled=true`, `maintenanceEnabled=true`에서 하이패스를 끄고
  즉시 정비도 끈다 → 첫 요청은 `hipass=false, maintenance=true`, 두 번째 요청은
  `hipass=true, maintenance=false`를 전 필드 업데이트한다. 두 번째 요청이 마지막이면 하이패스 OFF가
  사라지고 UI 상태도 완료 순서에 따라 되돌아간다.
- 제안 수정: 토글 변경은 즉시 함수형 `setForm`으로 병합하고 Firestore에는 변경된 필드 patch만 보낸다.
  실패 시 더 최신 변경을 덮어쓰지 않는 조건부 롤백을 적용한다. 입력 방식 최소 1개 규칙도 최신 상태를
  기준으로 평가하는 회귀 테스트를 추가한다.

### F-06 — 슈퍼관리자 전환 시 `orgDeleted` 잔존 가능

- 파일: `src/hooks/useAuth.tsx:110-160`, `src/components/auth/AuthGuard.tsx:127-138`
- 심각도: **LOW**
- 검증 상태: **PLAUSIBLE**
- 요약: 슈퍼관리자 org 구독 콜백은 `orgDeleted`를 갱신하지 않지만, AuthGuard는 역할 예외 없이
  `orgDeleted=true`를 차단 화면으로 보낸다. 같은 AuthProvider 세션에서 삭제 기관의 admin/employee가
  superAdmin으로 승격되면 이전 `true`가 지워지지 않을 수 있다.
- 재현 시나리오(입력 → 잘못된 결과): 삭제 기관 콜백으로 `orgDeleted=true`가 된 사용자 문서의 role을
  `superAdmin`으로 바꾼다 → 새 org 콜백은 기능 플래그만 갱신하고 `orgDeleted`를 false로 만들지 않아
  슈퍼관리자도 “기관이 삭제되었습니다” 화면에 남을 수 있다.
- 제안 수정: 슈퍼관리자 org watch 시작 또는 콜백 성공 시 `setOrgDeleted(false)`를 명시한다. LOW이므로
  이번 수정 PR에는 포함하지 않는다.

## 체크리스트별 확인 결과

| 점검 항목 | 결과 |
|---|---|
| 일반 admin/employee soft-delete | 기존 org 구독과 `status === 'deleted'` 판정 유지 |
| 슈퍼관리자 org 읽기 권한 | `organizations/{orgId}` read에 `isSuperAdmin()`이 있어 정상 |
| 슈퍼관리자 권한 오류 재시도 | 최대 2회로 유한하며 무한 재시도 없음 |
| 기능 플래그 테넌트 기준 | `useAuth`가 `userData.organizationId` 문서만 구독해 교차 기관 읽기 없음 |
| tenant-scoped 쿼리 필터 | 감사 대상 신규 쿼리에서 `organizationId` 누락 없음 |
| Zod 기본값 | 신규 boolean 전부 `.optional().catch(undefined)` |
| 기존 기관 호환 | `resolveOrgFeatures`가 `!== false`로 해석해 미설정 기관은 전 기능 ON |
| `allowedUsersEnabled=false` 후 기존 제한 | `createReservationSafe`와 `isVehicleRestrictedForUser`는 플래그와 무관하게 계속 강제 |
| 차량 수정 시 기존 `allowedUserIds` | 폼 초기값을 보존하고 저장 payload에 계속 포함해 숨김만으로 제한이 해제되지 않음 |

## 수정 PR 분리 제안

1. ~~`fix: 운행일지 운전자와 차량 참조 검증 강화` — F-01, F-02~~ → **잔여 위험 수용으로 결정, PR 없음**(위 조치 결정 참고)
2. `fix: 비활성 기관 기능의 직접 쓰기 차단` — F-03과 Rules 회귀 테스트 (후속 과제)
3. `fix: 캘린더 비활성 기관 동기화 중단` — F-04와 Functions 단위 테스트 → **PR #42 (리뷰 대기)**
4. `fix: 기능 토글 동시 저장 유실 방지` — F-05와 hook 단위 테스트 → **PR #41 (머지 완료)**

모든 PR은 `master`에서 별도 브랜치를 만들고, 로컬 `firebase deploy` 없이 Node 22 검증만 수행한다.
