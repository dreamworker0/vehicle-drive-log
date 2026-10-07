---
description: 코드 정리 — ESLint, 미사용 패키지 탐지, 빌드 검증까지 한번에 실행하고 제거 가능 여부를 판단한다. "안 쓰는 코드/패키지 정리해줘" 류 요청에 사용
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

## 제거 판단 가이드

명령이 보고한 후보를 **지우기 전에** 아래 기준으로 판단한다.

### 1. 정리 대상 판단 기준

| 대상 | 제거 O | 제거 X | 비고 |
|------|--------|--------|------|
| 어느 컴포넌트에서도 import하지 않는 export 함수 | ✅ | | `rg "함수명" src/`로 확인 |
| 주석 처리된 코드 블록 | ✅ | | Git 히스토리에 남아있으므로 안전 |
| 디버깅용 `console.log` | ⚠️ 판단 | | `console.error`는 에러 로깅이므로 유지 |
| `*_test.*`, `test-*` 일회성 스크립트 | ✅ | | `__tests__/` 안의 정식 테스트는 유지 |
| `*.bak`, `*.tmp`, `*.log` 파일 | ✅ | | |
| depcheck가 보고하는 unused dependency | ⚠️ 판단 | | 아래 §2 참고 |
| 빌드에 필요한 devDependency | | ❌ | autoprefixer, postcss, tailwindcss 등 |

### 2. depcheck false positive 목록

`depcheck`가 보고하지만 실제로는 필요한 패키지들:

```
autoprefixer       ← PostCSS 플러그인 (빌드 시 자동 호출)
postcss             ← TailwindCSS 빌드 체인
tailwindcss         ← CSS 프레임워크
@eslint/*           ← ESLint flat config에서 사용
globals             ← ESLint config에서 사용
eslint-plugin-*     ← ESLint 플러그인
@types/*            ← TypeScript 타입 정의
husky               ← Git 훅 (prepare 스크립트)
lint-staged         ← 프리커밋 훅
```

### 3. 판단이 어려울 때

- **라이브러리**: `package.json`에는 있지만 직접 import하지 않는 경우 → 빌드 도구 체인에서 쓰이는지 확인
- **export 함수**: 현재 미사용이지만 향후 확장 예정인 경우 → 사용자에게 확인
- **타입 정의**: 사용처가 없어 보이는 interface → re-export 체인을 추적
