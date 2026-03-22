---
description: 보안 감사 스크립트 실행 (npm audit + 커스텀 체크)
---

// turbo-all

1. Run security audit script:
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; npm run audit
```
Working directory: `.`
