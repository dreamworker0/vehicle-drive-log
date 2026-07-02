#!/usr/bin/env node
// PostToolUse(Edit|Write) 훅: .agent/skills|workflows 원본 편집 직후 .claude/ 브리지를 자동 재생성한다.
//
// 목적: "원본은 .agent/에서만 수정하고 npm run sync:agents로 재생성"(CLAUDE.md) 규칙에서
// 재생성 단계를 사람이/에이전트가 잊어 CI(--check)가 깨지는 일을 없앤다.
// 규칙 상세: .agent/rules/multi-agent-coordination.md §1.
//
// 동작:
//   - 변경 파일이 .agent/skills/ 또는 .agent/workflows/ 아래일 때만 실행
//   - scripts/sync-claude-agents.ts를 tsx로 실행해 .claude/skills·commands 재생성
//   - 동기화 실패 시 exit 2 + stderr → 에이전트에게 수동 조치(npm run sync:agents) 피드백
//   - 대상 외 파일·파싱 실패는 개입하지 않음(exit 0)
//
// 재귀 안전: 이 훅은 Edit/Write 도구 경유 편집에만 반응하고, sync 스크립트는 fs로 직접
// 쓰므로 훅이 다시 발화하지 않는다.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let payload;
try {
  // BOM 제거: PowerShell 파이프 등 일부 호출 경로가 UTF-8 BOM을 붙인다.
  payload = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
} catch {
  process.exit(0);
}

const filePath = payload?.tool_input?.file_path;
if (!filePath) process.exit(0);

// Windows 드라이브 문자·구분자 정규화 후 대상 경로인지 판별
const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
const rel = norm(filePath);
const root = norm(repoRoot);
const isTarget =
  rel.startsWith(`${root}/.agent/skills/`) || rel.startsWith(`${root}/.agent/workflows/`);
if (!isTarget) process.exit(0);

const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const syncScript = path.join(repoRoot, 'scripts', 'sync-claude-agents.ts');
if (!existsSync(tsxCli) || !existsSync(syncScript)) {
  process.stderr.write('[sync-agent-bridge] tsx 또는 sync 스크립트를 찾지 못했습니다. 수동으로 `npm run sync:agents`를 실행하세요.\n');
  process.exit(2);
}

try {
  execFileSync(process.execPath, [tsxCli, syncScript], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.exit(0);
} catch (err) {
  const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
  process.stderr.write(
    `[sync-agent-bridge] .agent → .claude 동기화 실패. 수동으로 \`npm run sync:agents\`를 실행해 원인을 확인하세요.\n${out}\n`,
  );
  process.exit(2);
}
