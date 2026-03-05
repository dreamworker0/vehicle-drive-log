---
description: 프론트엔드(Hosting)만 Firebase에 배포
---

// turbo-all

> ⚠️ **반드시 Node 22 LTS를 사용해야 합니다.** Node 24에서는 Rollup 스택 오버플로우가 발생합니다.

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

3. Build for production:
```
npm run build
```
Working directory: `.`

4. Deploy Hosting only:
```
firebase deploy --only hosting
```
Working directory: `.`
