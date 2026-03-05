---
description: Cloud Functions만 Firebase에 배포
---

// turbo-all

> ⚠️ **반드시 Node 22 LTS를 사용해야 합니다.** `functions/package.json`의 engines가 Node 22를 요구합니다.

1. Switch to Node 22 LTS:
```
fnm use 22
```
Working directory: `.`

2. Verify Node version (반드시 v22.x 확인):
```
node --version
```
Working directory: `.`

3. Deploy Cloud Functions:
```
firebase deploy --only functions
```
Working directory: `.`
