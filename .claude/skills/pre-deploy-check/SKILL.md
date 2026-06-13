---
name: pre-deploy-check
description: Firebase 배포 직전에 type-check, lint, test, 번들 크기, 인덱스 동기화, 환경 변수, CHANGELOG 갱신을 일괄 점검한다. 사용자가 "배포 전 점검", "배포 준비", "릴리즈 준비", "배포 가능한지 확인" 등을 요청할 때 발동한다.
---

<!-- AUTO-GENERATED — scripts/sync-claude-agents.ts가 .agent/skills/pre-deploy-check/SKILL.md에서 생성. 직접 수정 금지. -->

# pre-deploy-check

> 📄 **단일 원본**: [.agent/skills/pre-deploy-check/SKILL.md](../../../.agent/skills/pre-deploy-check/SKILL.md)
> 이 파일은 Claude Code 자동 발동을 위한 포인터다. 내용 수정은 원본에서 하고 `npm run sync:agents`로 재생성한다.

Firebase 배포 직전에 type-check, lint, test, 번들 크기, 인덱스 동기화, 환경 변수, CHANGELOG 갱신을 일괄 점검한다. 사용자가 "배포 전 점검", "배포 준비", "릴리즈 준비", "배포 가능한지 확인" 등을 요청할 때 발동한다.

전체 패턴·예시·체크리스트는 위 원본 파일을 읽고 따른다.
