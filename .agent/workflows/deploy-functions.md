---
description: Cloud Functions만 Firebase에 배포
---

// turbo-all

> ⚠️ **반드시 Node 22 LTS를 사용해야 합니다.** `functions/package.json`의 engines가 Node 22를 요구합니다.

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

3. Deploy Cloud Functions:
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; firebase deploy --only functions
```
Working directory: `.`
⚠️ exit code 1로 실패하면 최대 2회 재시도한다.
