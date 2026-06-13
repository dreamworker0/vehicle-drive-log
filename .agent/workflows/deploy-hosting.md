---
description: (긴급용) 프론트엔드(Hosting)만 로컬에서 Firebase에 수동 배포
---

> 🚨 **긴급 부분배포 — 정상 배포 경로가 아니다.**
> 기본 배포는 master 푸시 → CI([deploy.yml](../../.github/workflows/deploy.yml)). 이 워크플로우는
> CLAUDE.md 예외 조항("긴급 시에만 CI 미실행을 확인하고 Node 22로 실행")에 따른 **수동 배포 전용**이다.
> 아래 3가지를 모두 충족할 때만 진행한다:
> 1. 진행 중인 CI Deploy 워크플로가 없는가? → `gh run list --workflow=deploy.yml --limit 3`
> 2. Node 22인가?
> 3. 사용자가 긴급 수동 배포를 **명시적으로 승인**했는가?

// turbo-all

> ⚠️ **반드시 Node 22 LTS를 사용해야 합니다.** Node 24에서는 Rollup 스택 오버플로우가 발생합니다.

1. Activate fnm + Switch to Node 22 LTS:
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22
```
Working directory: `.`

2. Verify Node version (반드시 v22.x 확인):
```
node --version
```
Working directory: `.`

3. Lint + Type check:
```
npm run lint && npm run type-check
```
Working directory: `.`

4. Build for production:
```
npm run build
```
Working directory: `.`

5. Deploy Hosting only:
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; firebase deploy --only hosting
```
Working directory: `.`
⚠️ exit code 1로 실패하면 최대 2회 재시도한다.
