---
description: 차량운행일지 프로덕션 빌드 및 배포
---

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

3. Build for production:
```
npm run build
```
Working directory: `.`

4. Deploy Rules + Hosting:
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; firebase deploy --only "firestore,storage,hosting"
```
Working directory: `.`
⚠️ exit code 1로 실패하면 최대 2회 재시도한다.

5. Deploy Functions:
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; firebase deploy --only functions
```
Working directory: `.`
⚠️ exit code 1로 실패하면 최대 2회 재시도한다.
