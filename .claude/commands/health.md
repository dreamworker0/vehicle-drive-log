---
description: Cloud Functions 헬스 체크 실행
---

<!-- AUTO-GENERATED — scripts/sync-claude-agents.ts가 .agent/workflows/health.md에서 생성. 직접 수정 금지. -->

[.agent/workflows/health.md](../../.agent/workflows/health.md) 워크플로우를 수행한다.

원본 파일을 읽고 각 단계의 명령을 순서대로 실행하되, 다음을 지킨다:
- 각 단계의 `Working directory`를 준수하고, PowerShell 환경 기준으로 실행한다.
- 단계에 명시된 재시도/중단/스킵 규칙(예: "exit code 1로 실패 시 2회 재시도", "변경 없으면 스킵")을 그대로 따른다.
- `// turbo-all` 표시는 Antigravity 전용이므로 Claude Code에서는 무시한다.
- 워크플로우가 사용자 승인을 요구하면(긴급 가드 등) 반드시 먼저 확인한다.
