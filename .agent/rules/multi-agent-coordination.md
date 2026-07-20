---
description: Antigravity와 Claude Code를 번갈아 사용할 때의 공유 규칙. 파일 잠금, 동시 수정 충돌 회피, 설정 동기화 패턴.
---

# 멀티 에이전트 협업 규칙

이 프로젝트는 **Antigravity**와 **Claude Code** 두 AI 에이전트가 번갈아 작업한다.
에이전트 간 충돌을 방지하고 일관성을 유지하기 위한 규칙이다.

---

## 1. Single Source of Truth 구조

```
.agent/                    ← 공유 소스 (두 에이전트 모두 참조 / SSoT)
├── agents.md              ← 최상위 행동 규칙 (두 에이전트 공용 행동 헌법)
├── rules/                 ← 세부 규칙
├── skills/                ← 패턴 가이드
└── workflows/             ← 자동화 워크플로우 (Antigravity 형식, Claude Code는 커맨드 포인터로 소비)

CLAUDE.md                  ← Claude Code 진입점 (.agent/를 가리키는 포인터 문서)
.claude/skills/            ← Claude Code 자동발동 스킬 (.agent/skills/에서 자동 생성)
.claude/commands/          ← Claude Code 슬래시 커맨드 (.agent/workflows/에서 자동 생성)
.claude/settings.local.json ← Claude Code 개인 권한 설정 (로컬 전용, gitignore — 공용은 .claude/settings.json)
.agents/                   ← Antigravity 서브에이전트 작업 이력 (gitignore됨, 커밋 안 함)
```

> ℹ️ Claude Code 서브에이전트는 `.claude/agents/`에 둔다(현재 미사용).
> `.agents/`(끝에 s)는 Antigravity 전용 작업 스크래치이며 Claude Code의 "Goal 모드"와 무관하다.

### 브리지 자동 생성 (`.agent/` → `.claude/`)
- `.claude/skills/`와 `.claude/commands/`는 **수작업하지 않는다.** `scripts/sync-claude-agents.ts`가
  `.agent/skills/`·`.agent/workflows/`에서 **자동 생성**한다 (`npm run sync:agents`).
- 따라서 스킬/워크플로우 추가·수정은 **`.agent/` 원본 한 곳만** 고치고 `npm run sync:agents`로 재생성한 뒤 함께 커밋한다.
- Claude Code에서는 PostToolUse 훅(`scripts/hooks/sync-agent-bridge.mjs`)이 `.agent/skills/`·`.agent/workflows/` 편집 직후 자동으로 재생성한다. Antigravity 등 훅 밖에서 편집했다면 수동으로 `npm run sync:agents`.
- CI(`ci.yml`)와 `/sync-configs` 워크플로우가 `npm run sync:agents -- --check`로 동기화 누락을 차단한다.

### 규칙 변경 시
- **세부 규칙 변경** → `.agent/rules/` 파일 수정 (한 곳만)
- **스킬 변경** → `.agent/skills/` 파일 수정 (한 곳만)
- **CLAUDE.md** 수정은 Claude Code 전용 정보(스택, 명령어, `.agent/` 포인터)에 한정
- **agents.md**는 두 에이전트 공용 행동 헌법 — 특정 도구 전용 규칙은 넣지 않고, 세부 내용은 `rules/`로 위임

---

## 2. 동시 수정 방지

### 2.1 파일 단위 충돌 방지
- 한 에이전트가 수정 중인 파일을 다른 에이전트가 동시에 수정하지 않는다.
- 대규모 리팩토링은 한 에이전트에서만 수행하고 커밋 후 다른 에이전트로 전환한다.

### 2.2 커밋 단위 원칙
- 에이전트 전환 전에 반드시 `git add . && git commit` 으로 현재 변경사항을 커밋한다.
- 미커밋 변경이 있는 상태에서 에이전트를 전환하면 충돌 위험이 높아진다.

---

## 3. 설정 동기화

### 3.1 CLAUDE.md ↔ agents.md 정합성
- 두 문서에 동일한 규칙이 중복 기술되지 않도록 한다.
- CLAUDE.md는 `agents.md`를 참조하는 포인터 역할만 수행한다.
- 규칙 추가/변경 시 한쪽만 수정하고, 다른 쪽에서 참조가 깨지지 않는지 확인한다.

### 3.2 `.claude/skills/` ↔ `.agent/skills/` 동기화
- 원본은 `.agent/skills/`에 있다.
- `.claude/skills/`에는 Claude Code 자동발동이 필요한 스킬의 포인터만 둔다.
- 스킬 내용 수정은 항상 `.agent/skills/`에서 한다.

### 3.3 정합성 점검
- 주기적으로 (또는 대규모 변경 후) 아래 항목을 점검:
  - CLAUDE.md의 스킬 테이블이 `.agent/skills/` 디렉토리와 일치하는지
  - agents.md의 룰 참조가 `.agent/rules/` 파일들과 일치하는지
  - `.claude/skills/`의 포인터가 원본을 정확히 가리키는지
