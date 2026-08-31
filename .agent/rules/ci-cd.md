---
description: 차량운행일지 GitHub Actions 기반 CI/CD 파이프라인 규칙 및 배포 시나리오별 지침
---

# 🚀 CI/CD 파이프라인 규칙

이 문서는 차량운행일지 프로젝트의 GitHub Actions 워크플로우를 다룰 때 에이전트와 개발자가 준수해야 할 규칙이다.

---

## 1. 워크플로우 구성

`.github/workflows/` 디렉터리에 다음 3가지 핵심 워크플로우가 존재한다.

1. **`ci.yml` (CI/CD 검증)**
   - **트리거**: PR 생성·갱신, `master` 브랜치 푸시. **단 문서 전용 master 푸시는 제외**(§1.2)
   - **목적**: 빌드 및 테스트 통과 여부 검증 (Lint, Type Check, Build, Test)
2. **`deploy.yml` (프로덕션 배포)**
   - **트리거**: **`ci.yml` 완료(`workflow_run`)** — master 푸시가 직접 부르지 않는다. CI가 돌지 않으면 배포도 돌지 않는다(§1.2)
   - **목적**: Firebase Hosting, Functions, Firestore Rules 배포
3. **`preview.yml` (미리보기 배포)**
   - **트리거**: PR 생성
   - **목적**: PR에서 변경된 내용을 임시 Firebase Hosting URL로 배포하여 시각적 검증

### 1.1 `gemini-review.yml` (PR 자동 코드 리뷰) — 게이트가 아니다

`scripts/gemini-pr-review.ts`가 PR diff를 Gemini(`gemini-3.1-flash-lite`)에 보내 리뷰 코멘트를
남긴다. 범용 리뷰봇과 다른 점은 **CLAUDE.md와 `.agent/rules/`를 변경 경로에 맞춰 골라
프롬프트에 싣는다**는 것이다(규칙 파일이 단일 원본이므로 규칙을 고치면 리뷰 기준도 따라온다).

- **머지를 막지 않는다.** 실패해도 항상 exit 0이고 필수 체크로 걸지 않는다. 기계 판정을
  게이트로 쓰면 실패가 일상이 되어 진짜 실패를 못 알아본다. 판정의 축은 CI(lint·타입·테스트·
  Rules·E2E·번들 예산·CodeQL)에 그대로 둔다.
- **막지 않되 조용히 넘기지도 않는다.** 실패는 `::warning` 주석으로 실행 요약에 남긴다.
  모델 ID 오타나 API 형식 변경처럼 **항상** 실패하는 고장은 exit 0만 하면 "리뷰가 원래 안
  붙는 것"과 구별되지 않아 몇 달을 모르고 지나간다(Phase 114의 fail-open과 같은 함정).
- **봇이 쓴 코멘트만 갈아쓴다.** 갈아쓰기 식별자(마커)는 보이지 않는 HTML 주석이라 누구나
  자기 코멘트에 심을 수 있다. 작성자 확인 없이 마커만 보고 고르면, 공개 저장소에서 PR을 연
  사람이 마커 코멘트를 미리 남겨 리뷰 대상을 자기 코멘트로 돌릴 수 있다(`pull-requests: write`
  토큰은 남의 코멘트도 수정한다). 봇 작성자로 걸러 찾고, 없으면 새로 만든다.
- **프롬프트가 CI 중복 지적을 금지한다.** 포맷·미사용 변수·타입 오류·테스트 실패·번들 크기는
  이미 게이트가 막으므로 리뷰에 적으면 노이즈다.
- **`GEMINI_API_KEY` 저장소 시크릿이 필요하다.** 없으면 조용히 건너뛴다(워크플로는 초록).
  Functions가 쓰는 Secret Manager 키와는 별개 키를 쓴다 — 사고 범위를 분리한다.

**⚠️ `pull_request_target`을 `pull_request`로 바꾸지 말 것.** GitHub는 Dependabot·포크 PR에
시크릿을 주지 않으므로 `pull_request`로 두면 정작 의존성 PR에서 리뷰가 조용히 아무것도 하지
않는다(실패도 아니라 알아채기 어렵다). 대신 `pull_request_target`은 base 컨텍스트에서 돌기
때문에 **PR head 코드를 절대 실행해서는 안 된다** — 그래서 이 워크플로는 체크아웃에 `ref`를
주지 않고(base만 받는다), 의존성 설치·빌드·테스트를 일절 돌리지 않으며, PR 내용은 API로 받은
diff 텍스트로만 다룬다. 이 조건 중 하나라도 깨면 임의 코드 실행 경로가 열린다.

**이 워크플로는 자기 자신을 바꾸는 PR을 리뷰하지 못한다.** `pull_request_target`은 워크플로
정의를 **base(master)에서** 가져오므로, master에 아직 없는 워크플로는 그것을 추가하는 PR에서
실행되지 않고(Actions에 실행 기록조차 남지 않는다), 워크플로를 수정하는 PR에서도 **수정 전
버전**이 돈다. 고장이 아니라 head 코드를 실행하지 않는다는 안전 성질의 이면이다. 그래서
`gemini-review.yml`이나 `scripts/gemini-pr-review.ts`를 고치는 PR은 사람이 검토해야 하고,
변경 효과는 머지 이후 **다음** PR에서 처음 확인된다.

스크립트는 **의존성이 없다** — Node 22의 TS 타입 스트리핑과 내장 `fetch`만 쓰므로 워크플로에
`npm ci`가 없다(리뷰 1회당 20초 이상 절약). 그래서 타입 스트리핑이 지원하지 않는 문법
(enum·namespace·파라미터 프로퍼티)은 이 파일에 쓸 수 없다.

---

### 1.2 문서 전용 푸시는 CI도 배포도 돌지 않는다

`ci.yml`의 **master 푸시** 트리거에 경로 제외가 걸려 있다.

```yaml
paths-ignore:
  - 'docs/**'
  - '**.md'
```

1회 풀 사이클이 약 20분(CI ~16분 + Deploy ~4분)이라 문서 전용 푸시가 Actions 분량의 주된
소비처였기 때문이다(구현이력 Phase 91).

**여기서 놓치기 쉬운 것은 배포까지 함께 멈춘다는 점이다.** `deploy.yml`은 푸시가 아니라
`workflow_run`으로 **`ci.yml` 완료를 받아** 돈다. CI 실행이 아예 생성되지 않으면 그것을 받을
배포도 생성되지 않는다.

따라서 문서만 바꾼 PR을 머지하면 **master에 그 커밋의 워크플로 실행이 하나도 생기지 않는다.**
Actions 화면이 비어 있는 것이 정상이고, 배포를 기다리면 오지 않는다 — 2026-08-29에 실제로
그렇게 기다렸다(#240, 구현이력 Phase 177).

- **PR 트리거에는 이 제외가 없다.** 문서 PR에서도 `ci`·`e2e`는 정상적으로 돈다. 건너뛰는 것은
  **머지 후 master 푸시**뿐이다. PR이 초록이었다고 배포가 돈 것은 아니다.
- 코드와 문서가 섞인 푸시는 정상 실행된다.
- `.md` 전용 변경의 `sync:agents --check`는 다음 코드 푸시에서 검증된다.
- 문서 변경을 정말 배포해야 하면(랜딩에 노출되는 정적 파일 등) Deploy를 `workflow_dispatch`로
  수동 실행한다.

---

### 1.3 게이트를 무력화하는 두 함정 — `skipped`와 concurrency

필수 체크는 **`skipped`를 성공으로 취급한다.** 여기서 두 가지가 나온다(구현이력 Phase 136).

**① 잡을 `if`로 건너뛰어도 그 이름의 체크 런은 `skipped`로 생성된다.**
앞선 실행이 실패해 있었다면 **본문 수정만으로 빨간 PR이 초록이 된다.** master는 보호 브랜치이므로 실제 머지 위험이다.

→ 그래서 `edited`를 `ci.yml`에 두지 않고 `ci-retarget.yml`로 분리했다. 거기서 건너뛰는 잡 이름은 `revalidate` 하나뿐이고 **게이트가 한 번도 쓰지 않는 이름이라 덮어쓸 대상이 존재하지 않는다.**

**새 워크플로·잡을 추가할 때 지킬 것:**

- 제목·본문 `edited`로 발화하는 워크플로의 **잡 이름 ∩ 게이트 이름 = ∅** 이어야 한다
- 잡을 조건부로 건너뛰게 만들 때는 **그 이름이 필수 체크 목록에 있는지** 먼저 본다
- 새 잡을 게이트로 쓰려면 **브랜치 보호의 필수 체크 목록에 사람이 직접 추가**해야 한다. 하기 전까지 그 잡은 경고등이지 게이트가 아니다

**② concurrency 그룹이 진짜 실행을 죽인다.**
`cancel-in-progress`가 걸린 그룹을 메타 이벤트(제목·본문 수정)와 코드 푸시가 공유하면, 본문 수정 한 번이 진행 중이던 진짜 CI를 취소하고 잡이 전부 `skipped`인 실행이 그 자리를 차지한다 — **그 커밋에 게이트 결과가 하나도 남지 않는다.** 실제로 발생했다(실행 465 → 466).

→ 그룹 이름에 `meta`/`code` 구분자를 붙여 격리한다. `ci-retarget.yml`이 `ci.yml`과 **다른 그룹**을 쓰는 이유도 같다(2026-08-02 PR #115에서 실제로 진짜 CI가 죽었다).

### 1.4 게이트는 순서 때문에 묶이지 않게 한다

`Security audit`이 `ci` 잡의 마지막 스텝이던 시절, 앞 스텝이 하나라도 깨지면 감사가 **실행되지 않고 `skipped`** 됐다. 체크에는 "설치 실패"로만 뜨고 **감사 미실행 사실은 어디에도 남지 않는다.** 의존성 PR이야말로 감사가 가장 필요한 자리인데 정확히 거기서 빠졌다.

- **위치 때문에 묶인 것과 실제 의존을 구분한다.** E2E·번들 예산은 빌드 산출물이 실제로 필요하므로 의존을 남기고, 그렇지 않은 것은 `needs` 없는 독립 잡으로 뺀다
- 실패 마스킹을 막으려면 선행 산출물이 필요한 스텝만 `steps.<id>.outcome`으로 묶고 나머지는 `!cancelled()`로 각자 결론짓는다. 기본 동작은 한 번에 하나씩만 드러내 **16분 CI를 실패 개수만큼 반복시킨다**
- 번들 예산은 **빌드 직후**에 둔다. E2E 뒤에 두면 플레이크 한 번에 예산 초과가 묻힌다
- 올릴 수 없는 메이저는 Dependabot `ignore`로 막고 PR을 닫는다. 열어 두면 매주 되살아나 CI를 빨간 상태로 점유하는데, **실패가 일상이 되면 진짜 실패를 못 알아본다**

## 2. 배포 및 의존성 환경

### 2.1 Node.js 버전 고정
- **모든 환경(로컬, CI)에서 Node.js 22를 고정 사용한다.**
- Node 24 이상 버전에서는 Rollup 메모리 초과/스택 오버플로우 등의 빌드 에러가 보고되었으므로 절대 사용하지 않는다.
- 로컬 스크립트 실행 시 `fnm use 22` 명령어를 항상 동반한다.

### 2.2 Cloud Functions 빌드 최적화
Cloud Build에서의 2차 불필요한 빌드를 방지하기 위해 다음 설정을 유지한다.
- `functions/package.json`의 스크립트: `"gcp-build": ""`
- `functions/package.json`의 진입점: `"main": "lib/functions/src/index.js"`
- GitHub Actions 배포 단계에서 `firebase deploy --only functions` 실행 전, 로컬 워크스페이스에서 `cd functions && npm run build`를 선행하여 트랜스파일링된 결과물(`lib/`)을 업로드한다.

### 2.3 `.firebaseignore` 규칙
배포 시 용량 초과나 불필요한 파일 전송을 막기 위해 Cloud Functions 전송 범위는 최적화되어야 한다.
- `node_modules/`, `src/` (TypeScript 원본), 테스트 파일 등은 배포 대상에서 제외된다.

---

## 3. Dependabot 및 Secret 관리

Dependabot이 생성한 PR은 저장소의 Repository Secrets에 직접 접근할 권한이 없다.

### 3.1 Firebase Service Account 에러
- Dependabot PR 빌드 시 Firebase 배포 키나 서비스 계정 인증 에러(`firebaseServiceAccount` 접근 불가)가 발생할 수 있다.
- CI 설정에서 `if: ${{ github.actor != 'dependabot[bot]' }}` 조건을 사용하여, Dependabot이 생성한 PR에서는 배포 관련 Secret을 요구하는 Step(예: Preview 배포)을 우회하도록 구성해야 한다.

---

## 4. Sentry 릴리즈 · 소스맵 업로드

배포 워크플로([.github/workflows/deploy.yml](../../.github/workflows/deploy.yml))가 **배포가 성공한 뒤에만** `@sentry/cli`로 릴리즈를 등록한다. `@sentry/vite-plugin`은 쓰지 않는다 — 빌드 실패가 곧 배포 실패가 되는 것을 피하고, 실패한 배포가 릴리즈로 잡히지 않게 하려고 업로드를 배포 이후 단계로 분리했다.

### 4.1 파이프라인

| 단계 | 무엇을 하나 |
|---|---|
| 릴리즈 버전 | 배포 커밋 SHA (`SENTRY_RELEASE_VERSION`). 프런트는 `VITE_SENTRY_RELEASE`, Functions는 `functions/.env`의 `SENTRY_RELEASE`로 **같은 값**을 받아 한 배포가 하나의 릴리즈로 묶인다 |
| 소스맵 생성 | `SENTRY_SOURCEMAPS=1`일 때만 [vite.config.js](../../vite.config.js)이 `sourcemap: 'hidden'`으로 만든다. 평소 빌드에는 소스맵이 없다 |
| 업로드 | `sentry-cli sourcemaps upload --url-prefix '~/assets' dist/assets` — 번들 URL이 `https://<host>/assets/*.js`이므로 접두어를 맞춰야 매칭된다 |
| 커밋 연결 | `releases set-commits --auto`. Sentry의 GitHub 연동이 없으면 이 단계만 경고를 남기고 넘어간다(배포는 실패하지 않는다) |
| 마감 | `releases finalize` + `deploys new -e production` |

소스맵은 `firebase.json`의 `hosting.ignore`가 `**/*.map`을 제외해 **프로덕션에 배포되지 않는다**(원본 코드 비공개 유지).

### 4.2 필요한 저장소 설정

| 이름 | 종류 | 없으면 |
|---|---|---|
| `SENTRY_AUTH_TOKEN` | Secret | 이 스텝만 건너뛴다. 릴리즈 태깅 자체는 이벤트의 `release` 값으로 Sentry가 자동 생성하므로 동작하고, 스택트레이스만 압축된 번들 그대로 남는다 |
| `SENTRY_ORG` | Variable | 기본값 `socialprism` |
| `SENTRY_PROJECT` | Variable | 기본값 `javascript-react` |
| `SENTRY_PROJECT_FUNCTIONS` | Variable (선택) | Functions가 프런트와 같은 Sentry 프로젝트로 보고한다고 가정 |

### 4.3 함정 — 빈 시크릿은 조용히 건너뛴다

스텝 게이트는 잡 레벨 env `SENTRY_ENABLED: ${{ secrets.SENTRY_AUTH_TOKEN != '' && 'true' || 'false' }}`다. 시크릿을 **빈 값으로 등록**하면 목록에는 이름이 보이는데 게이트가 `false`가 되어 스텝이 `skipped`로 지나간다. 배포는 초록이라 눈치채기 어렵다(2026-08-30~31 배포 3건에서 실제로 발생).

최근 배포에서 이 스텝이 돌았는지 확인한다. `✓`면 성공, `-`면 skipped다.

```bash
gh run list --workflow=deploy.yml --limit 1
```

```bash
gh run view <실행ID> -v
```

> 파이프·`grep`을 쓰지 않는 형태다. 이 저장소의 주 셸인 PowerShell에는 `grep`이 없고(`Select-String`),
> `gh run view`에는 `--workflow` 플래그가 없다(그건 `gh run list`용). 잡 로그에서 게이트 값을 직접
> 봐야 할 때만 `gh run view <실행ID> --log`로 받아 `SENTRY_ENABLED`를 찾는다.

skipped면 토큰을 다시 넣는다. 프롬프트가 값을 마스킹하고 셸 히스토리에도 남지 않는다.

```bash
gh secret set SENTRY_AUTH_TOKEN
```

토큰 발급·갱신 절차는 [OPERATIONS.md](../../OPERATIONS.md) §5.1.1 참고.
