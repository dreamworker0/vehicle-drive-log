---
description: 프리커밋 훅(Husky + lint-staged) 설정 및 동작 설명. Git 커밋 전 자동 검증 관련 참고.
---

# 프리커밋 훅 (Pre-commit Hook)

Git 커밋 전에 자동으로 실행되는 검증 게이트. `Husky` + `lint-staged`로 구현.

## 1. 검증 범위

```
커밋 시도
   │
   ▼
lint-staged (스테이징된 파일만)
   ├── *.{ts,tsx} → ESLint --fix
   ├── *.{js,jsx} → ESLint --fix
   └── 통과 시 → 커밋 완료
```

## 2. `/git` 워크플로우와의 관계

| 검증 | 프리커밋 훅 | `/git` 워크플로우 |
|------|------------|-------------------|
| ESLint | ✅ 스테이징 파일만 | ✅ 전체 프로젝트 |
| Build | ❌ (속도 위해 생략) | ✅ 전체 빌드 |
| TypeScript | ❌ (속도 위해 생략) | ❌ (빌드에 포함) |
| Push | ❌ | ✅ |

> 프리커밋은 **빠른 안전망** (2~3초), `/git`은 **전체 검증 + 배포 전 게이트** (30초~1분).

## 3. 설치 상태

- **Husky**: `.husky/pre-commit` 파일로 관리
- **lint-staged**: `package.json`의 `lint-staged` 설정으로 관리
- **설치/재설치**: `/pre-commit` 워크플로우 참고
