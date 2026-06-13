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
1. npm run type-check (전체 tsc --noEmit)
   │
2. .agent/skills|workflows 스테이징 시 → npm run sync:agents → .claude/ 재스테이징
   │
3. lint-staged (스테이징된 파일만)
   ├── *.{ts,tsx} → ESLint --fix
   ├── *.{js,jsx} → ESLint --fix
   └── 통과 시 → 커밋 완료
```

> 2번 단계는 `.agent/` 원본 변경 시 `.claude/` 브리지(스킬 포인터·슬래시 커맨드)를 자동 재생성해 함께 커밋한다. CI의 `--check` 실패를 사전 차단한다. → [multi-agent-coordination](multi-agent-coordination.md)

## 2. `/git` 워크플로우와의 관계

| 검증 | 프리커밋 훅 | `/git` 워크플로우 |
|------|------------|-------------------|
| ESLint | ✅ 스테이징 파일만 | ✅ 전체 프로젝트 |
| Build | ❌ (속도 위해 생략) | ✅ 전체 빌드 |
| TypeScript | ✅ `npm run type-check` | ❌ (빌드에 포함) |
| .agent↔.claude 동기화 | ✅ 변경 시 자동 재생성 | — |
| Push | ❌ | ✅ |

> 프리커밋은 **빠른 안전망** (2~3초), `/git`은 **전체 검증 + 배포 전 게이트** (30초~1분).

## 3. 설치 상태

- **Husky**: `.husky/pre-commit` 파일로 관리
- **lint-staged**: `package.json`의 `lint-staged` 설정으로 관리
- **설치/재설치**: `/pre-commit` 워크플로우 참고
