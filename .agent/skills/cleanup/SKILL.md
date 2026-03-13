---
name: cleanup
description: 프로젝트 코드 정리 체크리스트 — 미사용 코드, 패키지, 임시 파일 탐색 가이드
---

# 코드 정리 스킬 (Cleanup)

프로젝트의 불필요한 코드, 패키지, 파일을 식별하고 제거하는 절차입니다.

## 1. 불필요한 파일 탐색

루트 및 하위 디렉터리에서 다음 패턴의 파일을 확인합니다:
- `*_test.*`, `test-*` — 일회성 테스트 스크립트
- `*_logs*`, `*.log` — 디버깅 로그
- `*.bak`, `*.tmp` — 백업/임시 파일

```bash
# 루트의 불필요 파일 확인
fd -t f -d 1 -e txt -e json --no-ignore . d:\apps\차량운행일지
```

## 2. 미사용 npm 패키지 탐지

```bash
npx -y depcheck --ignores="@types/*,autoprefixer,postcss,tailwindcss,@eslint/*,globals,eslint-plugin-*"
```

`depcheck`가 보고하는 **unused dependencies**를 확인합니다.
- devDependencies 중 빌드 도구(autoprefixer, postcss, tailwindcss)는 false positive이므로 무시합니다.

## 3. 미사용 export 함수 탐색

특정 lib 파일의 export가 실제 import되는지 확인합니다:

```bash
# 브리필로 확인
rg "함수명" --include "*.tsx" --include "*.ts" src/
```

## 4. ESLint 실행

```bash
npm run lint
```

- `no-unused-vars` 경고를 확인하여 미사용 변수/import 제거
- 불필요한 `console.log` 문 정리 여부 판단

## 5. 빌드 검증

정리 후 반드시 빌드가 정상인지 확인합니다:

```bash
npm run build
```

## 6. 정리 대상 판단 기준

| 판단 기준 | 제거 O | 제거 X |
|---|---|---|
| 어느 컴포넌트에서도 import하지 않음 | ✅ | |
| 디버깅용 console.log/console.error | ⚠️ 판단 필요 | |
| 주석 처리된 코드 블록 | ✅ | |
| 테스트/로그 파일 | ✅ | |
| 빌드에 필요한 devDependency | | ❌ |
