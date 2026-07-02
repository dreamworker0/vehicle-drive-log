---
name: code-cleanup
description: 프로젝트 코드 정리 판단 가이드 — 미사용 코드·패키지·임시 파일의 제거 가능 여부를 판별한다. "안 쓰는 코드/패키지 정리해줘" 류 요청 시 발동. (lint·depcheck·build 실행 시퀀스는 /cleanup 워크플로우)
---

# 코드 정리 스킬 (Code Cleanup)

프로젝트의 불필요한 코드, 패키지, 파일을 **식별하고 판단**하는 가이드.

> 실행 명령어 시퀀스는 `/cleanup` 워크플로우를 사용한다. (스킬명은 워크플로우와의 이름 충돌을 피해 `code-cleanup`)

## 1. 정리 대상 판단 기준

| 대상 | 제거 O | 제거 X | 비고 |
|------|--------|--------|------|
| 어느 컴포넌트에서도 import하지 않는 export 함수 | ✅ | | `rg "함수명" src/`로 확인 |
| 주석 처리된 코드 블록 | ✅ | | Git 히스토리에 남아있으므로 안전 |
| 디버깅용 `console.log` | ⚠️ 판단 | | `console.error`는 에러 로깅이므로 유지 |
| `*_test.*`, `test-*` 일회성 스크립트 | ✅ | | `__tests__/` 안의 정식 테스트는 유지 |
| `*.bak`, `*.tmp`, `*.log` 파일 | ✅ | | |
| depcheck가 보고하는 unused dependency | ⚠️ 판단 | | 아래 §2 참고 |
| 빌드에 필요한 devDependency | | ❌ | autoprefixer, postcss, tailwindcss 등 |

## 2. depcheck false positive 목록

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

## 3. 판단이 어려울 때

- **라이브러리**: `package.json`에는 있지만 직접 import하지 않는 경우 → 빌드 도구 체인에서 쓰이는지 확인
- **export 함수**: 현재 미사용이지만 향후 확장 예정인 경우 → 사용자에게 확인
- **타입 정의**: 사용처가 없어 보이는 interface → re-export 체인을 추적
