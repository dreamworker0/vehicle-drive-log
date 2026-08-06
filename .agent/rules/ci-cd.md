---
description: 차량운행일지 GitHub Actions 기반 CI/CD 파이프라인 규칙 및 배포 시나리오별 지침
---

# 🚀 CI/CD 파이프라인 규칙

이 문서는 차량운행일지 프로젝트의 GitHub Actions 워크플로우를 다룰 때 에이전트와 개발자가 준수해야 할 규칙이다.

---

## 1. 워크플로우 구성

`.github/workflows/` 디렉터리에 다음 3가지 핵심 워크플로우가 존재한다.

1. **`ci.yml` (CI/CD 검증)**
   - **트리거**: PR 생성 및 `master` 브랜치 푸시
   - **목적**: 빌드 및 테스트 통과 여부 검증 (Lint, Type Check, Build, Test)
2. **`deploy.yml` (프로덕션 배포)**
   - **트리거**: `master` 브랜치 푸시 (배포 조건 충족 시)
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

스크립트는 **의존성이 없다** — Node 22의 TS 타입 스트리핑과 내장 `fetch`만 쓰므로 워크플로에
`npm ci`가 없다(리뷰 1회당 20초 이상 절약). 그래서 타입 스트리핑이 지원하지 않는 문법
(enum·namespace·파라미터 프로퍼티)은 이 파일에 쓸 수 없다.

---

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

## 4. Sentry 소스맵 업로드 (현재 미구성)

프론트엔드 Sentry는 런타임 에러 수집만 구성되어 있고, **빌드 시 소스맵 자동 업로드는 배선되어 있지 않다** (`@sentry/vite-plugin` 미도입).
- 스택트레이스 원본 매핑이 필요해지면 `@sentry/vite-plugin`을 도입하고 `SENTRY_AUTH_TOKEN`을 CI 시크릿에 등록해야 한다.
- 그 전까지는 이 섹션이 향후 도입 대상일 뿐, 현재 배포 파이프라인에는 소스맵 업로드 단계가 없다.
