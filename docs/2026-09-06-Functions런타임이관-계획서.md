# Functions 런타임 메이저 이관 — 구현 계획서

- **작성일**: 2026-09-06
- **기준 커밋**: `d2a52c0`
- **스코프 모드**: HOLD (리팩토링·의존성 이관 — 명시 범위에 엄격, 스코프 변경 없음)
- **절차**: [planning-scope-review](../.agent/rules/planning-scope-review.md)
- **배경 실측**: [MAINTAINABILITY_BACKLOG.md](MAINTAINABILITY_BACKLOG.md) 「Functions 런타임 메이저 이관」

## 0. 과제

`firebase-admin` 13→14, `firebase-functions` 6→7 상향. 백로그의 **유일한 미착수 항목**이다.

## 1. 전제 도전

**진짜 문제인가.** 지금 당장 깨지는 것은 없다. 프로덕션은 admin 13 / functions 6으로 정상 동작하고, 사용자가 겪는 증상도 없다. **아무것도 안 하면 뭐가 깨지나 — 단기적으로는 아무것도.**

그럼에도 해야 하는 이유는 셋이다.

1. **보안 패치 경로가 막혀 있다.** 두 메이저를 dependabot ignore에 넣어 뒀으므로, 그 계열의 취약점 수정이 자동으로 오지 않는다. 지금은 편의지만 취약점이 뜨는 순간 부채가 된다.
2. **미룰수록 비싸진다.** 지금 측정된 차이는 3건뿐인데, 이 상태로 6개월을 더 두면 다음 메이저가 겹쳐 한 번에 넘어야 할 폭이 커진다.
3. **PR #287이 영구히 빨간 채 열려 있다.** `@types/express` 4→5는 단독으로는 절대 초록이 될 수 없다(§2). PR 목록의 상시 잡음이고, 다음 사람이 "왜 빨간지" 다시 조사하게 만든다.

**대리 지표 위험.** "최신 버전을 쓴다"를 목표로 삼으면 안 된다. 관측 대상은 버전 번호가 아니라 **dependabot이 다시 자동으로 흐르는가**와 **테스트 스위트가 그대로 초록인가**다.

## 2. 실측 결과 (2026-09-06)

브랜치에서 두 메이저를 실제로 설치해 측정했다. 측정 후 원복했다.

| 항목 | 백로그(2026-08-05) | 실측 |
|---|---|---|
| `admin.firestore` 네임스페이스 | 4건 | **0건** — 이미 해소 |
| 타입 오류 | 8개 파일 22건 | **3건**, 그것도 의존성 정렬로 0건 |
| `firebase-functions-test` | 언급 없음 | **차단** — 미사용이라 제거로 해소 |
| Jest × ESM `jose` | 언급 없음 | **17 스위트 차단 — 진짜 과제** |

**타입 오류 3건의 정체.** 코드 문제가 아니다. 트리에 express 타입이 두 벌 있어서 난다.

```
firebase-functions/node_modules/@types/express  (5, sendfile 없음)
functions/node_modules/@types/express           (4, sendfile 있음)
```

`@types/express`를 5로 올려 한 벌로 맞추면 `type-check:functions`가 **0건**이 된다. 즉 PR #287은 틀린 PR이 아니라 **순서가 어긋난** PR이다 — functions 7과 함께 가야 한다.

**진짜 과제.** `firebase-admin@14 → jwks-rsa@4.1.0 → jose@6.2.12`이고 jose 6은 CJS 빌드가 없다. ts-jest CommonJS 구성인 우리 Jest가 `require()`할 수 없어, `firebase-admin/auth`를 타고 들어가는 테스트가 **로드 단계에서** 죽는다(17 스위트 / 44회). **프로덕션 런타임은 영향 없다** — 배포 대상 Node 22는 ESM을 로드할 수 있다. 테스트 인프라만의 문제다.

## 3. 기존 코드 레버리지

- **이관 전제 테스트는 이미 있다.** `createAuthenticatedProxy.test.ts`가 401·429·uid 전달·rate limit 키를 고정한다. 이관의 최대 위험 지점이 이미 덮여 있다.
- **지연 로딩 선례가 있다.** `joinOrganization.ts:182`가 `await import("firebase-admin/auth")`를 쓴다. 다만 `module: "commonjs"` 하에서는 이것도 `require`로 내려가므로, **그 파일의 테스트가 통과하는 이유는 ESM을 제대로 로드해서가 아니라 그 경로를 실행하지 않아서다.** 해법을 고를 때 이 차이를 혼동하면 안 된다.
- **jest 설정은 한 곳**(`functions/package.json`의 `jest` 키)이고 `transform`이 `^.+\.tsx?$` 하나뿐이다. 손댈 표면이 좁다.

## 4. 구현 대안

`jose` 문제를 어떻게 푸느냐가 갈림길이고, 나머지(의존성 3종 상향 + 유령 패키지 제거)는 모든 안에 공통이다.

### A안 — `jose`를 변환 대상에 넣는다 (최소안)

`transformIgnorePatterns`에 `jose` 예외를 두고 babel 변환을 붙인다.

- **노력**: 설정 몇 줄 + babel 의존성. 소스 코드 무변경.
- **위험**: 낮음. 실패해도 테스트 단계에서 즉시 드러난다.
- **단점**: 테스트 시작이 느려진다(node_modules 변환). 다음에 또 다른 ESM 전용 의존성이 오면 목록에 계속 추가해야 한다 — **증상 대응**이다.
- ⚠️ **미검증**: ts-jest CJS + babel 혼용이 이 조합에서 실제로 통하는지는 확인하지 않았다. 30분 스파이크가 필요하다.

### B안 — `firebase-admin/auth`를 테스트에서 모킹한다

죽는 17개 스위트 대부분은 auth를 **쓰지 않는데** `helpers.ts`가 최상단에서 `getAuth`를 import해 딸려 들어간다. 그 경로를 끊는다.

- **노력**: 중간. `jest.mock` 추가 또는 `helpers.ts`의 import 구조 조정.
- **위험**: 중간. **프로덕션 코드를 테스트 편의로 바꾸는 것**이 되면 본말전도다. 모킹으로 끝나면 안전하고, `helpers.ts`를 고쳐야 한다면 그건 이관이 아니라 리팩토링이다.
- **장점**: 근본 원인(불필요한 eager import)을 줄인다. 테스트 속도도 좋아진다.

### C안 — Jest를 ESM 모드로 전환한다 (이상안)

`--experimental-vm-modules` + ESM 설정으로 옮긴다.

- **노력**: 큼. 77개 스위트 전체가 영향권이다.
- **위험**: 높음. 컴파일 결과가 CommonJS라는 이 프로젝트의 전제([cloud-functions.md §1](../.agent/rules/cloud-functions.md))와 정면으로 부딪힌다.
- **장점**: 앞으로 오는 ESM 전용 의존성에 다시 걸리지 않는다.
- **판단**: **주 7시간 가용에 맞지 않는다.** 이관 하나를 위해 테스트 인프라 전체를 흔드는 것은 이 프로젝트 규모에 과하다. 기록만 남기고 채택하지 않는다.

### 권고

**A안 스파이크 → 통하면 A, 안 통하면 B.** A가 소스 코드를 건드리지 않아 되돌리기 쉽고, 실패 판정이 30분이면 난다. B는 A가 막혔을 때의 대안이자, A로 갔더라도 나중에 따로 할 만한 개선이다.

**C안은 채택하지 않는다.** 다음에 또 ESM 전용 의존성에 걸리면 그때 다시 저울질한다.

## 5. 합의된 범위

**포함**

1. `firebase-admin` ^13 → ^14, `firebase-functions` ^6 → ^7, `@types/express` ^4 → ^5
2. `firebase-functions-test` devDependency 제거 (미사용 · admin 14를 막는 원인)
3. `jose` ESM 문제 해소 (A안 또는 B안)
4. `.github/dependabot.yml`에서 두 메이저 ignore 항목 제거
5. PR #287 닫기 (이 PR이 그 일을 포함하므로)

**제외 (opt-in 대상)**

- Jest ESM 전환(C안) — 별도 과제
- `helpers.ts`의 import 구조 리팩토링 — B안을 모킹으로 끝내지 못할 때만, 그때 따로 합의
- 다른 의존성 상향 — 이 PR에 섞지 않는다

## 6. 작업 순서

| # | 작업 | 산출물 |
|---|---|---|
| 1 | **A안 스파이크** — `transformIgnorePatterns` + babel로 `jose`가 로드되는지만 확인 | 통과/실패 판정 (30분) |
| 2 | 의존성 3종 상향 + `firebase-functions-test` 제거 | `functions/package.json`·`package-lock.json` |
| 3 | 1의 결과에 따라 A 또는 B 적용 | jest 설정 또는 테스트 모킹 |
| 4 | `type-check:functions` 0건 확인 | — |
| 5 | Functions 테스트 **77 suite / 1,054 전부 초록** 확인 | 기준선과 동일해야 한다 |
| 6 | `npm ci` 클린 설치 확인 (ERESOLVE 재발 방지) | — |
| 7 | 에뮬레이터에서 인증 프록시·Slack 웹훅 경로 확인 | — |
| 8 | dependabot ignore 제거 · PR #287 닫기 | `.github/dependabot.yml` |

## 7. 가드레일

- **테스트 수가 줄면 실패로 본다.** 기준선은 **77 suite / 1,054 테스트**(2026-09-06 측정). 스위트를 건너뛰거나 커버리지 임계값을 낮춰 초록을 만드는 것은 금지.
- **프로덕션 코드는 최소한만 건드린다.** 이관은 의존성 작업이다. 소스 변경이 필요해지면 그 순간 멈추고 왜 필요한지 먼저 적는다.
- **`createAuthenticatedProxy`는 배포 즉시 프로덕션이다.** `holidayProxy`·`tmapProxy`의 공통 관문이라, 이 파일이 관련된 변경은 에뮬레이터 확인을 건너뛰지 않는다.
- **`npm ci`를 반드시 통과시킨다.** peer 충돌은 로컬 `npm install`에서는 경고로 지나가고 CI에서 죽는다(PR #116의 실패 모드). `--legacy-peer-deps` 우회는 쓰지 않는다.
- **한 PR로 간다.** 의존성 상향과 테스트 인프라 수정을 나누면 중간 상태가 빨간 채로 남는다.

## 8. 검증 계획

- `npm run type-check:functions` — 0건
- `npm --prefix functions run test` — 77/1,054 초록
- `npm ci` (functions) — ERESOLVE 없음
- `npm run test:functions:emulator` — 인증 프록시 경로
- CI 전 체크 초록 후 머지 → 배포 후 `npm run health`로 함수 상태 확인

## 9. 배포 후 처리

- dependabot이 두 계열을 다시 자동 제안하는지 확인(다음 주기)
- 구현이력 Phase 기록 — 백로그 수치가 왜 틀렸는지(측정 없이 적은 추정치가 13개월 남았다)를 함께 남긴다

## 10. 결정 기록

| 결정 | 근거 |
|---|---|
| C안(Jest ESM) 미채택 | 주 7시간 가용에 비해 과하고, CommonJS 전제와 충돌 |
| A안 우선 | 소스 무변경·되돌리기 쉬움·30분 내 판정 |
| PR #287 닫기 | 단독으로는 구조상 초록이 될 수 없음 |
| `firebase-functions-test` 제거 | 미사용이면서 admin 14를 막는 유일한 peer 제약 |
| 한 PR로 진행 | 나누면 중간 상태가 빨갛다 |
