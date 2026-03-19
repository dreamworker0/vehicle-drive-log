---
description: 코드 정리 — ESLint, 미사용 패키지 탐지, 빌드 검증까지 한번에 실행
---

1. Run ESLint:
// turbo
```
npm run lint
```
Working directory: `.`

2. Check for unused dependencies (depcheck):
// turbo
```
npx -y depcheck --ignores="@types/*,autoprefixer,postcss,tailwindcss,@eslint/*,globals,eslint-plugin-*"
```
Working directory: `.`

3. Verify production build:
// turbo
```
npm run build
```
Working directory: `.`
