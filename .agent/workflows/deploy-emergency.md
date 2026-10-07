---
description: (긴급용) Hosting·Functions·Rules 중 필요한 것만 로컬에서 Firebase에 수동 배포
---

> 🚨 **긴급 부분배포 — 정상 배포 경로가 아니다.**
> 기본 배포는 master 푸시 → CI([deploy.yml](../../.github/workflows/deploy.yml)). 이 워크플로우는
> CLAUDE.md 예외 조항("긴급 시에만 CI 미실행을 확인하고 Node 22로 실행")에 따른 **수동 배포 전용**이다.
> 아래 3가지를 모두 충족할 때만 진행한다:
> 1. 진행 중인 CI Deploy 워크플로가 없는가? → `gh run list --workflow=deploy.yml --limit 3`
> 2. Node 22인가? (Node 24는 Rollup 스택 오버플로우, `functions/package.json` engines도 22를 요구)
> 3. 사용자가 긴급 수동 배포를 **명시적으로 승인**했는가?

// turbo-all

### 공통 준비

1. Activate fnm + Switch to Node 22 LTS, 버전 확인 (반드시 v22.x):
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; node --version
```
Working directory: `.`

2. Lint + Type check (Rules만 배포할 때는 생략 가능):
```
npm run lint; if ($?) { npm run type-check }
```
Working directory: `.`

### 대상별 배포 — 필요한 것만 실행

**Hosting (프론트엔드)**
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; npm run build; if ($?) { firebase deploy --only hosting }
```

**Cloud Functions**
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; cd functions; npm run build; cd ..; firebase deploy --only functions
```

**Firestore Rules + Storage Rules** — 먼저 dry-run으로 검증한다
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; firebase deploy --only "firestore:rules" --dry-run
```
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; firebase deploy --only "firestore:rules,storage"
```
Working directory: `.`
⚠️ exit code 1로 실패하면 최대 2회 재시도한다.
