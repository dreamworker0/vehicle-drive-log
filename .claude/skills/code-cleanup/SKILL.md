---
name: code-cleanup
description: 프로젝트 코드 정리 판단 가이드 — 미사용 코드·패키지·임시 파일의 제거 가능 여부를 판별한다. "안 쓰는 코드/패키지 정리해줘" 류 요청 시 발동. (lint·depcheck·build 실행 시퀀스는 /cleanup 워크플로우)
---

<!-- AUTO-GENERATED — scripts/sync-claude-agents.ts가 .agent/skills/code-cleanup/SKILL.md에서 생성. 직접 수정 금지. -->

# code-cleanup

> 📄 **단일 원본**: [.agent/skills/code-cleanup/SKILL.md](../../../.agent/skills/code-cleanup/SKILL.md)
> 이 파일은 Claude Code 자동 발동을 위한 포인터다. 내용 수정은 원본에서 하고 `npm run sync:agents`로 재생성한다.

프로젝트 코드 정리 판단 가이드 — 미사용 코드·패키지·임시 파일의 제거 가능 여부를 판별한다. "안 쓰는 코드/패키지 정리해줘" 류 요청 시 발동. (lint·depcheck·build 실행 시퀀스는 /cleanup 워크플로우)

전체 패턴·예시·체크리스트는 위 원본 파일을 읽고 따른다.
