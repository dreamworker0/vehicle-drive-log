---
description: 차량운행일지 GitHub Actions 기반 CI/CD 파이프라인 규칙 및 배포 시나리오별 지침
---

# 🚀 CI/CD 파이프라인 규칙

이 문서는 차량운행일지 프로젝트의 GitHub Actions 워크플로우를 다룰 때 에이전트와 개발자가 준수해야 할 규칙이다.

---

## 1. 워크플로우 구성

`.github/workflows/` 디렉터리에 다음 3가지 핵심 워크플로우가 존재한다.

1. **`ci.yml` (CI/CD 검증)**
   - **트리거**: PR 생성 및 `main` 브랜치 푸시
   - **목적**: 빌드 및 테스트 통과 여부 검증 (Lint, Type Check, Build, Test)
2. **`deploy.yml` (프로덕션 배포)**
   - **트리거**: `main` 브랜치 푸시 (배포 조건 충족 시)
   - **목적**: Firebase Hosting, Functions, Firestore Rules 배포
3. **`preview.yml` (미리보기 배포)**
   - **트리거**: PR 생성
   - **목적**: PR에서 변경된 내용을 임시 Firebase Hosting URL로 배포하여 시각적 검증

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

## 4. Sentry 소스맵 업로드

프로덕션 배포(`npm run build`) 시 Sentry 소스맵이 올바르게 업로드되어야 한다.
- Sentry 플러그인이 소스맵을 업로드하기 위해서는 환경변수에 `SENTRY_AUTH_TOKEN`이 올바르게 등록되어 있어야 한다.
- 로컬에서 프로덕션 배포 워크플로우를 테스트할 때, `.env.local`이나 시스템 환경변수에 해당 토큰이 누락되지 않았는지 확인한다.
