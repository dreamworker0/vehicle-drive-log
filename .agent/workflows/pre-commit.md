---
description: 프리커밋 훅(Husky + lint-staged) 설치 및 관리
---

# Pre-commit Hook 설치/관리

이 워크플로우는 Husky + lint-staged 기반의 Git 훅을 설치하거나 복구할 때 사용한다.
**훅 파일(`.husky/*`)과 lint-staged 설정(`package.json`)은 Git으로 추적되는 원본이 이미 존재한다.**
문서의 예시로 훅을 새로 써넣지 말 것 — 원본이 훼손되면 타입 검사·브리지 동기화 단계가 사라진다.

## 설치/복구

// turbo-all

1. 의존성 설치 + Husky 훅 활성화 (`prepare` 스크립트가 `husky`를 실행):
```
npm install
```
Working directory: `.`

2. 훅 파일이 손상·삭제된 경우 Git 원본으로 복구:
```powershell
git checkout -- .husky/pre-commit .husky/pre-push .husky/commit-msg
```
Working directory: `.`

3. 훅 내용 확인 (아래 "현재 훅 구성"과 일치해야 함):
```powershell
Get-Content .husky/pre-commit
```
Working directory: `.`

## 현재 훅 구성 (원본: `.husky/`)

| 훅 | 수행 내용 |
|----|----------|
| `pre-commit` | ① `npm run type-check` (전체 tsc) → ② `.agent/skills\|workflows` 스테이징 시 `npm run sync:agents`로 `.claude/` 브리지 재생성 + 재스테이징 → ③ `npx lint-staged` |
| `commit-msg` | `commitlint` — 한국어 + Conventional Commits 강제 |
| `pre-push` | `npm run test` → `npm run build` → `npm run audit` |

## lint-staged 설정 (원본: `package.json`)

```json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx}": [
      "eslint --fix --no-warn-ignored --max-warnings=0",
      "vitest related --run"
    ]
  }
}
```

- 스테이징된 파일만 ESLint 자동 수정 + **관련 단위 테스트**(`vitest related`)까지 실행한다.
- 설정을 바꿀 때는 `package.json`의 `lint-staged` 키를 직접 수정한다 (별도 설정 파일 없음).

## 동작 방식

- `git commit` 실행 시 → Husky가 `.husky/pre-commit` 실행 → 실패하면 커밋 차단
- `git push` 실행 시 → `.husky/pre-push`가 테스트·빌드·보안감사 실행 → 실패하면 푸시 차단
- 상세 규칙: [.agent/rules/pre-commit.md](../rules/pre-commit.md)

## 주의사항

- pre-commit은 **빠른 안전망**(타입 검사 + 스테이징 파일 lint/테스트), 전체 검증은 `npm run verify:full` 또는 `/git`·`/deploy` 워크플로우.
- `--no-verify` 플래그로 훅을 건너뛸 수 있으나 권장하지 않음
