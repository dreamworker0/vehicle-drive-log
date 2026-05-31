---
description: 프로젝트 초기 설정(의존성 설치, Husky 훅 설치, 로컬 환경변수 복사 등)을 수행하는 온보딩 자동화 스크립트
---

# 프로젝트 환경 설정 스크립트 (Setup / Onboard)

이 워크플로우는 처음 저장소를 클론받은 개발자나 로컬 환경 최신화가 필요할 때 실행합니다.
다음 명령어들을 순차적으로 실행하여 즉시 개발에 투입될 수 있는 로컬 환경을 구성합니다.

## 1. 패키지 의존성 설치
```bash
// turbo
npm install
```

## 2. 필수 `.env` 파일 확인 및 복사
> [!NOTE]
> `.env.local` 파일이 존재하지 않는 경우 `.env.example` 템플릿으로부터 복사합니다.
> **주의**: 로컬에서 프로덕션 빌드나 이메일 발송 기능을 테스트하려면 `SENTRY_AUTH_TOKEN`, `EMAILJS_PRIVATE_KEY` 등의 민감한 Secret이 `.env.local`에 반드시 채워져 있어야 합니다.
```bash
// turbo
if (-not (Test-Path ".env.local")) { Copy-Item ".env.example" ".env.local" ; Write-Host ".env.local 파일이 생성되었습니다. 필요한 키를 입력해 주세요." } else { Write-Host ".env.local 파일이 이미 존재합니다." }
```

## 2.5. Node.js 환경 고정 (Node 22 LTS)
> [!IMPORTANT]
> 프로젝트의 호환성을 위해 반드시 Node 22 환경으로 강제 전환합니다.
```bash
// turbo
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22
```

## 3. Husky 및 Pre-commit 훅 초기화
> [!NOTE]
> /pre-commit 워크플로우에 기반하여 Husky를 현재 npm 환경에 연동합니다.
```bash
// turbo
npm run prepare
```

## 4. 로컬 빌드 검증
> [!IMPORTANT]
> 설치가 정상적인지 확인하기 위해 Lint, Type Check, 빌드를 1회 수행합니다.
```bash
// turbo
npm run lint && npm run type-check && npm run build
```

---
> **완료 메세지**
> 모든 설정이 완료되었습니다! `npm run dev`를 실행하여 개발 서버를 시작해 주세요.
