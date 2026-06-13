---
description: CLAUDE.md ↔ agents.md ↔ rules/ ↔ skills/ 간 정합성을 자동 점검
---

에이전트 설정 파일 간 불일치(팬텀 참조, 누락 스킬, 중복 규칙)를 탐지한다.

1. CLAUDE.md에서 참조하는 스킬 경로가 실제로 존재하는지 확인:
// turbo
```
Get-Content "CLAUDE.md" | Select-String -Pattern '\.agent/skills/([^/]+)/SKILL\.md' -AllMatches | ForEach-Object { $_.Matches } | ForEach-Object { $skill = $_.Groups[1].Value; $path = ".agent/skills/$skill/SKILL.md"; $exists = Test-Path $path; Write-Host "$(if($exists){'✓'}else{'✗'}) $skill $(if(-not $exists){'← 팬텀 참조!'})" }
```
Working directory: `.`

2. agents.md에서 참조하는 룰 파일이 실제로 존재하는지 확인:
// turbo
```
Get-Content ".agent/agents.md" | Select-String -Pattern '\(rules/([^)]+\.md)\)' -AllMatches | ForEach-Object { $_.Matches } | ForEach-Object { $rule = $_.Groups[1].Value; $path = ".agent/rules/$rule"; $exists = Test-Path $path; Write-Host "$(if($exists){'✓'}else{'✗'}) $rule $(if(-not $exists){'← 팬텀 참조!'})" }
```
Working directory: `.`

3. .agent/skills/ 디렉토리의 모든 스킬이 CLAUDE.md에 매핑되어 있는지 확인:
// turbo
```
$skills = Get-ChildItem ".agent/skills" -Directory | Select-Object -ExpandProperty Name; $claude = Get-Content "CLAUDE.md" -Raw; $skills | ForEach-Object { $found = $claude -match $_; Write-Host "$(if($found){'✓'}else{'⚠'}) $_ $(if(-not $found){'← CLAUDE.md에 누락'})" }
```
Working directory: `.`

4. .claude/ 브리지(스킬 포인터 + 슬래시 커맨드)가 .agent/ 원본과 동기화돼 있는지 확인:
// turbo
```
npm run sync:agents -- --check
```
Working directory: `.`
> 💡 `.claude/skills/`(자동 발동 포인터)와 `.claude/commands/`(슬래시 커맨드)는 `scripts/sync-claude-agents.ts`가 `.agent/skills/`·`.agent/workflows/`에서 자동 생성한다. 어긋나면 `npm run sync:agents`로 재생성 후 커밋한다.

5. .agent/rules/ 디렉토리의 룰 파일 목록 출력 (총 개수 포함):
// turbo
```
$rules = Get-ChildItem ".agent/rules" -File; Write-Host "총 $($rules.Count)개 룰 파일:"; $rules | ForEach-Object { Write-Host "  - $($_.Name) ($([math]::Round($_.Length/1024, 1))KB)" }
```
Working directory: `.`

> 💡 **불일치 발견 시**: `✗` 또는 `⚠` 표시된 항목을 수동으로 수정하거나, 에이전트에게 수정을 요청하세요.
