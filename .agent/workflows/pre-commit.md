---
description: 프리커밋 훅(Husky + lint-staged) 설치 및 관리
---

# Pre-commit Hook 설치/관리

이 워크플로우는 Husky + lint-staged 기반의 프리커밋 훅을 설치하거나 재설정할 때 사용한다.

## 설치 (최초 1회)

// turbo-all

1. Husky + lint-staged 설치:
```
npm install -D husky lint-staged
```
Working directory: `.`

2. Husky 초기화:
```
npx husky init
```
Working directory: `.`

3. pre-commit 훅 파일 작성:
```powershell
Set-Content -Path ".husky/pre-commit" -Value "npx lint-staged" -NoNewline
```
Working directory: `.`

## lint-staged 설정

`package.json`에 다음 설정이 포함되어야 한다:

```json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": [
      "eslint --fix --max-warnings=0"
    ]
  }
}
```

## 동작 방식

- `git commit` 실행 시 → Husky가 `.husky/pre-commit` 실행
- `npx lint-staged` → 스테이징된 파일만 ESLint 검사 + 자동 수정
- ESLint 에러가 있으면 → 커밋 차단

## 주의사항

- 프리커밋 훅이 속도를 위해 **빌드/테스트는 실행하지 않음**
- 전체 검증이 필요하면 `/git` 또는 `/deploy` 워크플로우를 사용
- `--no-verify` 플래그로 훅을 건너뛸 수 있으나 권장하지 않음
