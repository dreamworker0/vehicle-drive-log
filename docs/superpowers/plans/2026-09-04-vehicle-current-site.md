# 차량 현재 위치(출발지 가변화) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 24시간 운영 기관처럼 차량이 기관↔숙소를 편도로 오가는 경우, 관리자가 차량의 고정 출발지를 매번 고쳐 주지 않아도 운전자가 운행일지에서 출발지와 세운 곳을 고를 수 있게 하고, 차량이 지금 어디 있는지를 운행 직전 화면에서 확인할 수 있게 한다.

**Architecture:** 차량 문서의 `siteId`는 **기본 차고지**로 유지하고, 실제 위치는 `currentSiteId`로 분리한다. 새 UI는 전부 **차량별 플래그 `siteVaries`** 뒤에 둔다 — 출발지가 실제로 바뀌는 차량은 기관 안에서도 일부뿐이다. 위치 갱신은 클라이언트가 하지 않고 이미 차량 부수효과를 전담하는 Cloud Functions 트리거(`syncDriveLogKm.ts`)에 얹어, 교차 테넌트 검증과 소급 입력 방어(`isEffectivelyRetroactive`)를 그대로 재사용한다. 그 결과 Firestore Rules는 건드리지 않는다.

**Tech Stack:** React 19, TypeScript, Zod, Firebase Functions(Node 22), Firestore, Vitest

**Spec:** 별도 spec 없음 — 설계 배경은 아래 §설계 배경에 통합한다.

## 설계 배경

### 왜 자유 텍스트가 아닌가

요청 기관의 실제 패턴은 **기관 ↔ 숙소** 두 고정 지점의 반복이지 임의 장소가 아니다. 그리고 `startLocation`은 단순 라벨이 아니라 `resolveDepartureAddress()`를 거쳐 **Tmap 경로 탐색의 origin**이 된다(`src/hooks/useQuickDriveStart.ts:129`). 주소 없는 자유 텍스트를 받으면 거리·소요시간·통행료가 조용히 어긋나, 이 기관이 겪는 문제의 원인만 바뀌고 해결되지 않는다.

대신 이미 있는 기관 설정의 출발지 목록(`organization.sites[]`)에 "숙소"를 주소와 함께 등록하게 하면, 라벨이 정형화될 뿐 아니라 **거리 계산까지 처음으로 정확해진다.**

### 왜 게이트가 기관이 아니라 차량 단위인가

`hasBranchSites`(분관이 하나라도 등록됨)를 "출발지가 바뀌는 기관"의 신호로 쓰면 안 된다. 분관 기능은 원래 **분산되어 있지만 고정된** 차량을 위해 만든 것이다 — `shared/orgSites.ts`의 주석대로 "분관에 세워 둔 차량은 실제로 분관에서 출발하므로" 거리를 맞추려는 목적이었다. 따라서 분관을 등록한 기관의 대다수는 여전히 전 차량 고정이고, 그들에게 출발지 선택을 띄우면 얻는 것 없이 잘못 고를 기회만 생긴다.

기관 단위 설정으로도 부족하다. 요청 기관 자신이 "차량 1~2대 정도는 출발지가 달라집니다"라고 썼다. 기관 토글을 켜면 나머지 고정 차량의 운전자들도 매번 출발지를 고르게 되어, 같은 문제가 기관 안에서 재현된다.

그래서 차량 문서에 `siteVaries` 플래그를 두고 **출발지 선택·세운 곳 선택·위치 배지의 신선도 표시를 모두 이 하나로 게이트한다.** 기본값이 꺼짐이므로 "운전자가 못 바꾸게 하고 싶다"는 요구는 별도 금지 설정 없이 기본 상태로 충족된다.

### 왜 예약 문서에는 저장하지 않는가

한 달 뒤 예약을 만드는 사람은 그때 차가 어디 있을지 모른다. 예약 시점의 선택을 문서에 못 박으면, 정작 운행 당일에는 낡은 값이 사람을 없는 곳으로 보낸다. 차의 위치는 **계획이 아니라 상태**이므로 차량 문서에 두고, 예약 화면은 그 값을 읽어서 보여 주기만 한다.

따라서 예약 **생성** 화면의 거리 계산은 지금처럼 차량의 기본 차고지(`siteId`) 기준을 유지한다. 예약 시점 거리는 어차피 예상치이고, 기록에 남는 값은 일지 작성 시 확정된 출발지로 계산된다.

### 위치가 표시되어야 하는 화면

차 위치가 필요한 순간은 예약을 만들 때가 아니라 **차를 가지러 갈 때**다. 그래서 표시는 `ReservationCard`(오늘의 예약 카드, 이미 30분 전~15분 경과 임박 판정 로직 보유)와 바로 운행 화면에만 넣는다.

### 자가 치유

현재 위치가 틀리면 운전자가 바로 운행/오늘 카드에서 "숙소"라는 표시와 눈앞의 현실이 다른 것을 알아채고, 일지 작성 시 출발지를 고쳐 기록한다. 그 기록이 다시 트리거를 통해 위치를 바로잡는다. 관리자 수동 보정은 이 루프가 막혔을 때의 최후 수단이다.

## Global Constraints

- 스코프 모드는 `SELECTIVE`. 자유 텍스트 출발지 입력, 기관 단위 허용/금지 설정, 예약 스키마 변경은 이번 범위에서 **제외**한다.
- 신규 UI의 노출 조건은 **두 가지가 모두 참일 때**다: `hasBranchSites(sites)` **그리고** 해당 차량의 `siteVaries === true`. 둘 중 하나라도 거짓이면 화면은 이전과 동일해야 한다.
- 분관을 등록하지 않은 기관, 그리고 분관은 등록했지만 전 차량이 고정 출발지인 기관의 화면·내보내기 파일은 **한 픽셀도 바뀌지 않아야 한다.**
- `siteVaries`의 기본값은 `false`다. 관리자가 명시적으로 켠 차량에만 새 동작이 적용된다.
- Firestore Rules는 변경하지 않는다. 차량 위치 갱신은 Admin SDK(트리거)와 기존 관리자 update 경로로만 이루어진다.
- 모든 npm·TypeScript 검증은 Node 22에서 실행한다 (`fnm exec --using=22 npm.cmd ...`).
- 로컬 `firebase deploy`는 실행하지 않는다. 배포는 master 푸시로 CI가 수행한다.
- 사용자 화면이 바뀌므로 업데이트 소식(공지)을 반드시 추가한다 (`npm run check:release-notes`가 누락을 차단).
- 문서 전용 커밋과 코드 커밋을 분리한다.

## 데이터 모델 변경 요약

| 문서 | 필드 | 성격 |
|---|---|---|
| `vehicles` | `siteId` | **기존 유지** — 기본 차고지. 위치 이력이 없을 때의 fallback |
| `vehicles` | `siteVaries` | 신규. 출발지가 매번 바뀌는 차량인가. 신규 UI 전체의 게이트, 기본 `false` |
| `vehicles` | `currentSiteId` | 신규. 지금 실제로 서 있는 출발지 id |
| `vehicles` | `currentSiteUpdatedAt` | 신규. 그 값이 확인된 시각 (화면에 신선도 표기) |
| `driveLogs` | `startLocation` | **기존 유지** — 출발지 라벨. 이제 운전자가 고른 값이 들어간다 |
| `driveLogs` | `endSiteId` | 신규. 운행 후 차를 세운 출발지 id. 트리거가 이 값을 읽는다 |

`driveLogs`에 세운 곳의 **라벨**은 저장하지 않는다. 세운 곳은 보고서 항목이 아니라 운영 상태이고, 사람이 읽을 도착 정보는 이미 `destination`에 있다. 이 결정 덕에 PDF·Excel 내보내기는 손대지 않는다.

---

### Task 1: 스키마와 공용 해석 함수 확장

**Files:**
- Modify: `src/schemas/vehicle.ts:72-75`
- Modify: `src/schemas/driveLog.ts`
- Modify: `shared/orgSites.ts`
- Modify: `src/__tests__/lib/orgSites.test.ts`

**Interfaces:**
- Consumes: `organization.sites[]`, `vehicle.siteId`, `vehicle.currentSiteId`, `vehicle.siteVaries`
- Produces: `resolveVehicleCurrentSite(sites, vehicle)` — 현재 위치를 우선하고, 없거나 삭제된 분관을 가리키면 기본 차고지 → 본관 순으로 되돌린다
- Produces: `canChooseSite(sites, vehicle)` — 신규 UI 노출 여부의 **단일 판정**. `hasBranchSites(sites) && vehicle?.siteVaries === true`

- [ ] **Step 1: 실패하는 테스트를 먼저 쓴다 (RED)**

`src/__tests__/lib/orgSites.test.ts`에 `resolveVehicleCurrentSite` 케이스를 추가한다.

- `currentSiteId`가 유효하면 그 출발지를 돌려준다
- `currentSiteId`가 없으면 `siteId`(기본 차고지)로 되돌아간다
- `currentSiteId`가 삭제된 분관을 가리키면 `siteId`로 되돌아가고, 그것도 없으면 본관을 돌려준다

이어서 `canChooseSite` 케이스도 함께 쓴다.

- 분관이 없으면 `siteVaries`가 참이어도 거짓 (고를 대상이 하나뿐이다)
- 분관이 있어도 `siteVaries`가 거짓·미설정이면 거짓 (**기존 기관 대다수가 이 경우다**)
- 분관이 있고 `siteVaries`가 참일 때만 참

Run:

```powershell
fnm exec --using=22 npm.cmd test -- src/__tests__/lib/orgSites.test.ts
```

Expected: `resolveVehicleCurrentSite is not a function`으로 실패한다.

- [ ] **Step 2: `shared/orgSites.ts`에 해석 함수를 추가한다**

기존 `resolveVehicleSite`는 **기본 차고지 해석**으로 그대로 두고(예약 생성 화면이 계속 쓴다), 현재 위치 해석을 별도 함수로 추가한다. 두 개념을 한 함수에 합치면 예약 화면이 의도치 않게 현재 위치를 쓰게 된다.

```ts
/**
 * 차량이 지금 서 있는 곳. 운행 종료 기록으로 갱신되는 실제 위치를 우선하고,
 * 값이 없거나 이미 지워진 분관을 가리키면 기본 차고지 → 본관 순으로 되돌린다.
 * 예약 **생성** 화면은 이 함수를 쓰지 않는다 — 미래 시점의 위치는 알 수 없다.
 */
export function resolveVehicleCurrentSite(
    sites: OrgSite[],
    vehicle?: { siteId?: string; currentSiteId?: string } | null
): OrgSite
```

`resolveDepartureAddress`는 시그니처를 바꾸지 말고, 현재 위치 기준 주소가 필요한 호출부를 위해 `resolveCurrentDepartureAddress`를 새로 추가한다.

노출 판정도 같은 파일에 둔다. 조건을 화면마다 손으로 조합하면 한 곳을 빠뜨렸을 때 고정 차량에 선택 UI가 새는데, 그 화면은 아무도 안 보고 지나간다.

```ts
/**
 * 운전자가 이 차량의 출발지를 고를 수 있는가.
 * 분관이 등록돼 있고, 관리자가 그 차량을 "출발지가 바뀜"으로 표시했을 때만 참이다.
 * 분관 기능 자체는 **분산되어 있지만 고정된** 차량을 위한 것이라, 분관 등록만으로
 * 선택 UI를 띄우면 전 차량 고정인 기관에 잘못 고를 기회만 생긴다.
 */
export function canChooseSite(
    sites: OrgSite[],
    vehicle?: { siteVaries?: boolean } | null
): boolean {
    return hasBranchSites(sites) && vehicle?.siteVaries === true;
}
```

- [ ] **Step 3: Zod 스키마에 필드를 추가한다**

`src/schemas/vehicle.ts`의 `siteId` 바로 아래:

```ts
/**
 * 출발지가 매번 바뀌는 차량인가. 관리자가 켠 차량에만 운전자용 출발지 선택이 열린다.
 * 기본값이 거짓이라, 분관을 등록했더라도 전 차량 고정인 기관의 화면은 그대로다.
 */
siteVaries: z.boolean().optional().catch(undefined),
/**
 * 차량이 지금 서 있는 출발지 id. 운행 종료 기록으로 서버 트리거가 갱신한다.
 * 미설정이면 `siteId`(기본 차고지)에서 출발하는 것으로 본다.
 */
currentSiteId: z.string().optional().catch(undefined),
/** 위 값이 확인된 시각 — 화면에 "○○ 기준"으로 신선도를 함께 보여 준다. */
currentSiteUpdatedAt: timestampSchema.optional().catch(undefined),
```

`src/schemas/driveLog.ts`의 `startLocation` 아래:

```ts
/** 운행 후 차를 세운 출발지 id. 서버 트리거가 차량의 현재 위치를 갱신하는 근거다. */
endSiteId: z.string().optional().catch(undefined),
```

**주의:** 스키마에 빠뜨린 필드는 컨버터가 조용히 제거한다. 저장은 되고 조회는 안 되는 상태가 되므로 이 단계를 건너뛰면 이후 전 단계가 조용히 실패한다.

- [ ] **Step 4: GREEN 확인**

Run:

```powershell
fnm exec --using=22 npm.cmd test -- src/__tests__/lib/orgSites.test.ts src/__tests__/schemas
fnm exec --using=22 npm.cmd run type-check
```

Expected: 전부 통과. `schemaCoverage.test.ts`가 신규 필드를 요구하면 그 목록도 함께 갱신한다.

---

### Task 2: 서버 트리거에서 차량 현재 위치 갱신

**Files:**
- Modify: `functions/src/handlers/triggers/syncDriveLogKm.ts:184-243` (`onDriveLogCreated`)
- Modify: `functions/src/handlers/triggers/syncDriveLogKm.ts:247-` (`onDriveLogUpdated`)
- Create: `functions/src/__tests__/syncDriveLogSite.test.ts`

**Interfaces:**
- Consumes: `driveLog.endSiteId`, `driveLog.organizationId`, `driveLog.vehicleId`, `driveLog.timestamp`
- Produces: `vehicles/{id}.currentSiteId`, `vehicles/{id}.currentSiteUpdatedAt`

- [ ] **Step 1: 갱신 규칙을 테스트로 고정한다 (RED)**

`functions/src/__tests__/syncDriveLogSite.test.ts`에 다음을 쓴다.

- `endSiteId`가 있고 그 기록이 해당 차량의 최신 운행이면 `currentSiteId`가 갱신된다
- **소급 입력(더 최신 운행이 이미 있는 경우)에는 갱신하지 않는다** — 어제 운행을 오늘 입력해도 오늘 위치를 덮어쓰지 않는다
- 차량의 `organizationId`가 운행일지와 다르면 갱신하지 않는다 (교차 테넌트 오염 차단)
- `endSiteId`가 없으면 아무것도 하지 않는다

트리거는 `siteVaries`를 따로 확인하지 않는다. `endSiteId`는 게이트를 통과한 화면에서만 기록되므로 값의 존재 자체가 이미 판정 결과다. 여기서 플래그를 다시 읽으면, 관리자가 나중에 플래그를 끈 순간 처리 중이던 기록이 조용히 버려진다.

Run:

```powershell
fnm exec --using=22 npm.cmd --prefix functions test -- syncDriveLogSite
```

Expected: 갱신 함수가 없어 실패한다.

- [ ] **Step 2: 갱신 헬퍼를 추가한다**

`applyChainCurrentKm` 근처에 위치 갱신 헬퍼를 만든다. **기존 `isEffectivelyRetroactive` 판정을 재사용**한다 — 소급 방어를 새로 만들면 두 규칙이 서로 어긋난다.

```ts
/**
 * 차를 세운 곳을 차량의 현재 위치로 반영한다.
 * 소급 입력(더 최신 운행이 이미 있는 경우)에는 갱신하지 않는다 — 어제 기록이
 * 오늘 위치를 덮어쓰면 차를 찾으러 간 사람이 엉뚱한 곳으로 간다.
 */
async function applyVehicleCurrentSite(
    orgId: string, vehId: string, endSiteId: string | undefined,
    ts: Date, isEffectivelyRetroactive: boolean
): Promise<void>
```

`currentKm` 갱신과 마찬가지로 차량 문서를 읽어 `organizationId` 일치를 확인한 뒤에만 쓴다. 불일치 시 `console.warn`으로 남긴다.

- [ ] **Step 3: 두 트리거에 연결한다**

- `onDriveLogCreated`: `isEffectivelyRetroactive` 계산 직후에 호출한다
- `onDriveLogUpdated`: 수정으로 `endSiteId`가 바뀌었을 때만 호출한다 (매 수정마다 시각을 갱신하면 신선도 표기가 거짓말이 된다)

`onDriveLogDeleted`는 **건드리지 않는다.** 삭제된 운행 이전의 위치를 되돌리려면 이력 재구성이 필요한데, 그만한 가치가 없고 관리자 수동 보정(Task 5)으로 해결된다.

- [ ] **Step 4: GREEN 확인**

Run:

```powershell
fnm exec --using=22 npm.cmd --prefix functions test
fnm exec --using=22 npm.cmd --prefix functions run build
```

Expected: 전부 통과. 컴파일 결과가 CommonJS이므로 ESM 전용 구문을 쓰지 않았는지 빌드로 확인한다.

---

### Task 3: 운행일지 폼에 출발지·세운 곳 선택 추가

**Files:**
- Modify: `src/components/employee/driveLogFormLayout/WaypointSection.tsx`
- Modify: `src/components/employee/DriveLogForm.tsx:145-152`
- Modify: `src/hooks/driveLogForm/types.ts`
- Modify: `src/hooks/driveLogForm/useDriveLogSubmit.ts:73-74, 250`
- Modify: `src/hooks/driveLogForm/submitDriveLog.ts:38-39, 68-75`
- Modify: `src/hooks/driveLogForm/useDriveLogInitializer.ts`
- Create: `src/__tests__/components/DriveLogSiteSelect.test.tsx`

**Interfaces:**
- Consumes: `useAuth().orgSites`, 선택된 차량의 `currentSiteId`/`siteId`
- Produces: `driveLog.startLocation`(라벨), `driveLog.endSiteId`(id)

- [ ] **Step 1: 노출 조건과 기본값을 테스트로 고정한다 (RED)**

- 분관 미등록 기관에서는 두 선택이 **렌더되지 않는다**
- 분관은 등록됐지만 `siteVaries`가 꺼진 차량에서도 **렌더되지 않는다** (기존 기관 대다수의 경로다 — 이 케이스가 빠지면 회귀를 놓친다)
- `siteVaries`가 켜진 차량에서 출발지 기본값 = 차량의 현재 위치
- 세운 곳 기본값 = 선택된 출발지 (대부분 왕복이므로 확인만 하고 넘어간다)
- 출발지를 바꾸면 세운 곳 기본값도 따라 바뀐다. 단 사용자가 세운 곳을 직접 건드린 뒤에는 따라가지 않는다
- 차량을 바꾸면 게이트가 다시 평가된다 — 유동 차량에서 고정 차량으로 바꾸면 선택이 사라지고 `endSiteId`도 비워진다

Run:

```powershell
fnm exec --using=22 npm.cmd test -- src/__tests__/components/DriveLogSiteSelect.test.tsx
```

Expected: 실패한다.

- [ ] **Step 2: `WaypointSection`에 두 선택을 추가한다**

목적·행선지 섹션 안, 도착지 위에 출발지를 두고 아래에 세운 곳을 둔다. 출발 → 도착 → 세운 곳의 시간 순서가 그대로 위에서 아래로 읽히게 한다.

- 컨트롤은 프로젝트 공용 `select` 클래스를 쓴다 (`src/components/admin/VehicleForm.tsx:282` 주변의 출발지 select와 같은 모양)
- 두 컨트롤 모두 `canChooseSite(orgSites, selectedVehicle)`가 참일 때만 렌더한다. 조건을 여기서 손으로 다시 조합하지 않는다
- 세운 곳에는 "다음에 이 차를 여기서 찾게 됩니다" 정도의 짧은 도움말을 붙인다 — 이 선택이 왜 필요한지 모르면 아무 값이나 고르게 된다

- [ ] **Step 3: 폼 상태와 제출 경로를 잇는다**

- `types.ts`의 폼 타입에 `startSiteId`, `endSiteId`를 추가한다
- `useDriveLogInitializer`에서 차량 선택·수정 모드 진입 시 기본값을 채운다. **수정 모드에서는 기록에 남은 값을 그대로 복원한다** (차량의 현재 위치로 덮으면 과거 기록이 오늘 상태로 오염된다)
- `startLocation`은 지금처럼 라벨을 넘기되, 출처를 차량의 `siteId`가 아니라 **폼에서 고른 `startSiteId`** 로 바꾼다
- `endSiteId`는 `submitDriveLog`의 `buildLogData`까지 그대로 흘려보낸다

- [ ] **Step 4: GREEN 확인**

Run:

```powershell
fnm exec --using=22 npm.cmd test -- src/__tests__/components src/__tests__/hooks
fnm exec --using=22 npm.cmd run lint
fnm exec --using=22 npm.cmd run type-check
```

Expected: 전부 통과.

---

### Task 4: 운행 직전 화면에 현재 위치 표시

**Files:**
- Modify: `src/components/employee/ReservationCard.tsx`
- Modify: `src/components/employee/TodayDashboard.tsx:170-180`
- Modify: `src/hooks/useQuickDriveStart.ts:124-180`
- Modify: `src/__tests__/hooks/useQuickDriveStart.test.ts`
- Create: `src/__tests__/components/ReservationCard.test.tsx` (없으면)

**Interfaces:**
- Consumes: `vehicle.currentSiteId`, `vehicle.currentSiteUpdatedAt`, `orgSites`
- Produces: 카드의 위치 배지, 바로 운행의 경로 탐색 origin

- [ ] **Step 1: 표시 규칙을 테스트로 고정한다 (RED)**

- 분관 미등록 기관에서는 배지가 나오지 않는다
- **고정 차량**(`siteVaries` 꺼짐)은 기본 차고지 이름만 나오고 **시각은 나오지 않는다** — 늘 거기 있으므로 "언제 확인된 값인가"가 의미 없다
- **유동 차량**은 현재 위치 이름과 `currentSiteUpdatedAt` 기준 시각이 함께 나온다
- 유동 차량인데 `currentSiteUpdatedAt`이 없으면 시각 없이 이름만 나온다 (아직 한 번도 기록되지 않은 차량)
- 바로 운행의 경로 탐색 origin은 **유동 차량일 때만** 현재 위치 주소이고, 고정 차량은 기존대로 기본 차고지 주소다

- [ ] **Step 2: `ReservationCard`에 위치 배지를 넣는다**

차량 이름 아래, 이미 있는 아이콘·색상 규칙(`getVehicleColor`, `VEHICLE_TYPE_ICONS`)과 같은 줄에 배치한다.

```
고정 차량   🚩 제2분관
유동 차량   🚩 숙소 · 9/1 17:20 기준
```

유동 차량에는 시각을 반드시 함께 보여 준다. 시각이 없으면 사용자는 그 값이 방금 확인된 것인지 3주 전 것인지 판단할 수 없고, 한 번 헛걸음하면 기능 자체를 믿지 않게 된다. 반대로 고정 차량에 시각을 붙이면 바뀌지도 않는 값에 낡음을 암시해 불필요한 의심을 만든다.

고정 차량에도 **위치 이름은 남긴다.** 그 차를 처음 쓰는 직원에게는 여전히 필요한 정보이고, `resolveStartLocationLabel`이 이미 같은 이유로 라벨을 기록하고 있다.

`isInProgress`(운행 중)인 카드에는 위치 대신 운행 중임을 보여 준다 — 그 차는 지금 어느 주차장에도 없다.

- [ ] **Step 3: 바로 운행의 origin을 현재 위치로 바꾼다**

`src/hooks/useQuickDriveStart.ts:129`에서 **유동 차량일 때만** `resolveCurrentDepartureAddress`를 쓰고, 고정 차량은 기존 `resolveDepartureAddress`를 그대로 탄다. `departureSiteName`(`:179`)도 같은 분기를 따른다. 바로 운행은 정의상 지금 출발이므로 유동 차량에서는 현재 위치가 곧 출발지다.

**`src/hooks/reservationCalendar/useRouteInfo.ts`는 바꾸지 않는다.** 예약 생성 화면은 미래 시점을 다루므로 기본 차고지 기준을 유지한다.

- [ ] **Step 4: GREEN 확인**

Run:

```powershell
fnm exec --using=22 npm.cmd test -- src/__tests__/hooks/useQuickDriveStart.test.ts src/__tests__/components
fnm exec --using=22 npm.cmd run lint
```

Expected: 전부 통과. `useRouteInfo` 관련 기존 테스트가 하나도 깨지지 않아야 한다 — 깨진다면 예약 생성 화면을 잘못 건드린 것이다.

---

### Task 5: 관리자 화면 — 유동 차량 지정과 위치 수동 보정

**Files:**
- Modify: `src/components/admin/VehicleForm.tsx:275-295`
- Modify: `src/hooks/useVehicleManager.ts:30-35, 130-200`
- Modify: `src/lib/auditLogLabels.ts`
- Modify: `src/__tests__/hooks/useVehicleManager.test.ts` (없으면 생성)

**Interfaces:**
- Consumes: 관리자 입력
- Produces: `vehicle.siteVaries`, `vehicle.currentSiteId`, `vehicle.currentSiteUpdatedAt`

- [ ] **Step 1: 테스트를 먼저 쓴다 (RED)**

- 분관 미등록 기관의 차량 폼에는 "출발지가 매번 바뀜" 체크박스가 나오지 않는다 (고를 대상이 하나뿐이다)
- 체크박스를 켜야 "현재 위치" 선택이 나타난다 — 고정 차량에 현재 위치를 물으면 기본 차고지와 뜻이 겹친다
- 저장 시 `currentSiteId`와 `currentSiteUpdatedAt`이 함께 갱신된다 (시각 없이 id만 바꾸면 화면의 신선도 표기가 과거에 멈춘다)
- 체크박스를 끄면 `currentSiteId`가 지워진다 — 남겨 두면 나중에 다시 켰을 때 몇 달 전 위치가 되살아난다
- 감사 로그 라벨이 한국어로 나온다

- [ ] **Step 2: 폼에 체크박스와 현재 위치 선택을 추가한다**

기존 출발지 select 바로 아래에 둔다. 세 항목의 뜻이 겹치지 않게 라벨을 분명히 나눈다.

| 필드 | 라벨 | 뜻 |
|---|---|---|
| `siteId` | 기본 차고지 | 평소 이 차가 서 있는 곳 |
| `siteVaries` | 출발지가 매번 바뀜 | 켜면 운전자가 운행일지에서 직접 고른다 |
| `currentSiteId` | 현재 위치 | 지금 실제로 있는 곳. 운행 기록으로 자동 갱신 |

셋 다 "출발지"로 부르면 관리자가 무엇을 고치는지 알 수 없다. 체크박스에는 **켜면 운전자 화면이 바뀐다**는 결과를, 현재 위치에는 **자동 갱신된다**는 사실을 각각 도움말로 밝힌다. 후자를 빠뜨리면 관리자가 매번 손으로 맞춰야 하는 항목으로 오해한다.

- [ ] **Step 3: `auditLogLabels.ts`에 라벨을 추가한다**

```ts
siteVaries: '출발지 변경 허용',
currentSiteId: '현재 위치',
```

- [ ] **Step 4: GREEN 확인**

Run:

```powershell
fnm exec --using=22 npm.cmd test -- src/__tests__/hooks/useVehicleManager.test.ts
fnm exec --using=22 npm.cmd run type-check
```

---

### Task 6: 공지·문서·전체 검증

**Files:**
- Modify: 업데이트 소식 데이터 (`npm run check:release-notes`가 지목하는 파일)
- Modify: `docs/구현이력/트랙B_Phase181부터.md`
- Modify: `docs/차량운행일지_구현계획서.md` (§17 포인터·메타)

- [ ] **Step 1: 업데이트 소식을 추가한다**

`release-notes` 스킬을 따른다. 사용자에게 전할 내용은 두 가지다.

- 출발지가 매번 바뀌는 차량은 운행일지에서 출발지와 차를 세운 곳을 직접 고를 수 있다
- 오늘의 예약 카드에서 그 차가 지금 어디 있는지 볼 수 있다

**켜는 방법을 반드시 함께 적는다** — ① 설정에서 출발지(분관)를 등록하고 ② 차량 관리에서 해당 차량의 "출발지가 매번 바뀜"을 켠다. 두 단계 모두 밝히지 않으면 "우리는 왜 안 보이냐"는 문의가 몰린다. 기본값이 꺼짐이라 **아무것도 하지 않으면 화면이 그대로**라는 점도 함께 적어, 고정 출발지로 잘 쓰고 있는 기관을 안심시킨다.

- [ ] **Step 2: 전체 게이트를 돌린다**

Run:

```powershell
fnm exec --using=22 npm.cmd run verify:full
```

Expected: 전부 통과. Rules를 바꾸지 않았으므로 `test:rules`도 기존 그대로 통과해야 한다 — 여기서 실패하면 클라이언트가 차량 문서에 위치를 직접 쓰고 있다는 뜻이므로 Task 2로 되돌아간다.

- [ ] **Step 3: 회귀 지점을 직접 확인한다**

두 종류의 기존 기관 계정으로 각각 확인한다. **두 번째가 이번 변경의 진짜 회귀 지점이다** — 분관을 이미 쓰고 있는 기관이 가장 많이 영향받을 수 있는 쪽이다.

분관 미등록 기관:

- 운행일지 폼에 새 선택이 **나오지 않는다**
- 오늘의 예약 카드에 위치 배지가 **나오지 않는다**
- Excel·PDF 내보내기 파일이 이전과 **동일하다**

분관은 등록했지만 전 차량이 고정인 기관 (`siteVaries` 전부 꺼짐):

- 운행일지 폼에 새 선택이 **나오지 않는다**
- 예약 생성 화면의 거리·소요시간·통행료가 이전과 **동일하다**
- 바로 운행의 경로 계산이 기본 차고지 기준으로 **그대로다**
- 위치 배지가 나오더라도 **시각 없이 이름만** 나온다

- [ ] **Step 4: 이력을 기록한다**

`docs/구현이력/트랙B_Phase181부터.md`에 Phase를 추가하고, `docs/차량운행일지_구현계획서.md` §17의 포인터와 메타를 갱신한다. 코드 커밋과 분리해 `chore:` 커밋으로 남긴다.

---

## 이번 범위에서 제외한 것

| 항목 | 이유 |
|---|---|
| 자유 텍스트 출발지 | 경로 계산 origin이 깨진다. 등록 방식으로 대부분 해결되는지 먼저 확인한다 |
| 기관 단위 허용/금지 설정 | 차량별 `siteVaries`가 더 정확하다. 요청 기관도 1~2대만 유동이라, 기관 단위로 켜면 나머지 고정 차량 운전자에게 같은 문제가 생긴다. 기본값이 꺼짐이라 "전면 금지"는 이미 기본 상태다 |
| 예약 문서의 출발지 필드 | 미래 시점의 위치는 알 수 없어, 저장하면 낡은 값이 사람을 오도한다 |
| 운행일지 삭제 시 위치 되돌리기 | 이력 재구성 비용 대비 가치가 낮고 관리자 수동 보정으로 해결된다 |
| 세운 곳 라벨의 내보내기 반영 | 보고서 항목이 아니라 운영 상태다. 도착 정보는 `destination`에 이미 있다 |

## 후속 후보

1단계 배포 후에도 "등록 안 된 곳에서 출발했다"는 요청이 남으면, 출발지 선택 맨 아래에 `기타(직접 입력)`를 붙인다. 그 값은 라벨로만 기록하고 경로 계산은 기본 차고지 주소로 되돌리되, 화면에 "거리는 ○○ 기준"임을 명시해야 한다. 처음부터 넣으면 모두 그것만 쓰게 되어 거리 데이터를 통째로 못 믿게 된다.
