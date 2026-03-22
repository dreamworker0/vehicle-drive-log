---
description: Cloud Functions 헬스 체크 실행
---

// turbo-all

1. Run Cloud Functions health check:
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; npm run health
```
Working directory: `.`
