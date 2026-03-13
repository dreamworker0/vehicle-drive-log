---
description: Firestore Rules + Storage Rules만 Firebase에 배포
---

// turbo-all

1. Deploy security rules (Firestore + Storage):
```
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression; fnm use 22; firebase deploy --only "firestore:rules,storage"
```
Working directory: `.`
⚠️ exit code 1로 실패하면 최대 2회 재시도한다.
