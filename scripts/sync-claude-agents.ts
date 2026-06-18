/**
 * .agent/ 단일 원본을 Claude Code가 인식하는 .claude/ 구조로 동기화한다.
 *
 *  - .agent/skills/<name>/SKILL.md   → .claude/skills/<name>/SKILL.md   (자동 발동 포인터)
 *  - .agent/workflows/<name>.md      → .claude/commands/<name>.md        (슬래시 커맨드 포인터)
 *
 * Antigravity와 Claude Code가 동일한 룰/스킬/워크플로우를 공유하기 위한 브리지.
 * 내용 수정은 항상 .agent/ 원본에서 하고, 이 스크립트로 .claude/를 재생성한다.
 *
 * 사용법:
 *   npm run sync:agents          # .claude/ 재생성
 *   npm run sync:agents -- --check  # CI용. 동기화가 어긋나 있으면 exit 1
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const AGENT_SKILLS = path.join(ROOT, '.agent', 'skills');
const AGENT_WORKFLOWS = path.join(ROOT, '.agent', 'workflows');
const CLAUDE_SKILLS = path.join(ROOT, '.claude', 'skills');
const CLAUDE_COMMANDS = path.join(ROOT, '.claude', 'commands');

/** 자동 생성 파일 식별용 마커. 이 마커가 없는 파일은 삭제하지 않는다(수작업 파일 보호). */
const MARKER = 'AUTO-GENERATED — scripts/sync-claude-agents.ts';

interface Frontmatter {
  name?: string;
  description?: string;
}

/** 마크다운 상단 `--- ... ---` 프론트매터에서 name/description 단일 라인 값을 추출한다. */
function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const block = match[1];
  const pick = (key: string): string | undefined => {
    const line = block.split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
    if (!line) return undefined;
    return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
  };
  return { name: pick('name'), description: pick('description') };
}

/** frontmatter description가 없을 때 첫 H1 제목(이모지 제거)을 설명으로 대체한다. */
function fallbackTitle(content: string): string | undefined {
  const heading = content.split(/\r?\n/).find((l) => /^#\s+/.test(l));
  if (!heading) return undefined;
  return heading.replace(/^#\s+/, '').replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim();
}

/** 스킬 포인터(.claude/skills/<name>/SKILL.md) 내용 생성. */
function renderSkill(dir: string, fm: Frontmatter): string {
  // 스킬의 정식 ID는 디렉터리명이다. 프론트매터 name이 슬러그와 다르게 오염돼도
  // (한글 제목·따옴표 등) 포인터는 항상 디렉터리명을 사용해 드리프트를 막는다.
  const name = dir;
  const description = fm.description ?? '';
  return `---
name: ${name}
description: ${description}
---

<!-- ${MARKER}가 .agent/skills/${dir}/SKILL.md에서 생성. 직접 수정 금지. -->

# ${name}

> 📄 **단일 원본**: [.agent/skills/${dir}/SKILL.md](../../../.agent/skills/${dir}/SKILL.md)
> 이 파일은 Claude Code 자동 발동을 위한 포인터다. 내용 수정은 원본에서 하고 \`npm run sync:agents\`로 재생성한다.

${description}

전체 패턴·예시·체크리스트는 위 원본 파일을 읽고 따른다.
`;
}

/** 커맨드 포인터(.claude/commands/<name>.md) 내용 생성. */
function renderCommand(name: string, fm: Frontmatter): string {
  const description = fm.description ?? '';
  return `---
description: ${description}
---

<!-- ${MARKER}가 .agent/workflows/${name}.md에서 생성. 직접 수정 금지. -->

[.agent/workflows/${name}.md](../../.agent/workflows/${name}.md) 워크플로우를 수행한다.

원본 파일을 읽고 각 단계의 명령을 순서대로 실행하되, 다음을 지킨다:
- 각 단계의 \`Working directory\`를 준수하고, PowerShell 환경 기준으로 실행한다.
- 단계에 명시된 재시도/중단/스킵 규칙(예: "exit code 1로 실패 시 2회 재시도", "변경 없으면 스킵")을 그대로 따른다.
- \`// turbo-all\` 표시는 Antigravity 전용이므로 Claude Code에서는 무시한다.
- 워크플로우가 사용자 승인을 요구하면(긴급 가드 등) 반드시 먼저 확인한다.
`;
}

/** 생성 대상 파일 경로 → 내용 맵을 구성한다. */
function buildDesired(): Map<string, string> {
  const desired = new Map<string, string>();

  // 스킬
  for (const dir of fs.readdirSync(AGENT_SKILLS)) {
    const src = path.join(AGENT_SKILLS, dir, 'SKILL.md');
    if (!fs.existsSync(src)) continue;
    const fm = parseFrontmatter(fs.readFileSync(src, 'utf8'));
    desired.set(path.join(CLAUDE_SKILLS, dir, 'SKILL.md'), renderSkill(dir, fm));
  }

  // 워크플로우 → 커맨드
  for (const file of fs.readdirSync(AGENT_WORKFLOWS)) {
    if (!file.endsWith('.md')) continue;
    const name = file.replace(/\.md$/, '');
    const raw = fs.readFileSync(path.join(AGENT_WORKFLOWS, file), 'utf8');
    const fm = parseFrontmatter(raw);
    if (!fm.description) fm.description = fallbackTitle(raw) ?? `${name} 워크플로우`;
    desired.set(path.join(CLAUDE_COMMANDS, `${name}.md`), renderCommand(name, fm));
  }

  return desired;
}

/** 현재 디스크에 있는 자동 생성 파일 목록(마커 보유분만). */
function listGenerated(): string[] {
  const out: string[] = [];
  const scan = (dir: string, isSkill: boolean) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const p = isSkill ? path.join(dir, entry, 'SKILL.md') : path.join(dir, entry);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
      if (fs.readFileSync(p, 'utf8').includes(MARKER)) out.push(p);
    }
  };
  scan(CLAUDE_SKILLS, true);
  scan(CLAUDE_COMMANDS, false);
  return out;
}

const isCheck = process.argv.includes('--check');
const desired = buildDesired();
const existingGenerated = listGenerated();
const drift: string[] = [];

// 줄바꿈 정규화 후 비교 (Windows autocrlf로 작업 트리가 CRLF여도 거짓 드리프트 방지)
const norm = (s: string): string => s.replace(/\r\n/g, '\n');

// 내용 비교 / 쓰기
for (const [filePath, content] of desired) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  if (current !== null && norm(current) === norm(content)) continue;
  drift.push(path.relative(ROOT, filePath));
  if (!isCheck) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

// 원본에서 사라진 자동 생성 파일 제거(마커 보유분만)
for (const filePath of existingGenerated) {
  if (desired.has(filePath)) continue;
  drift.push(`(stale) ${path.relative(ROOT, filePath)}`);
  if (!isCheck) {
    fs.rmSync(filePath, { force: true });
    const dir = path.dirname(filePath);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
}

if (isCheck) {
  if (drift.length > 0) {
    console.error('❌ .claude/ 가 .agent/ 원본과 동기화되어 있지 않습니다. `npm run sync:agents` 실행 후 커밋하세요:');
    drift.forEach((d) => console.error(`   - ${d}`));
    process.exit(1);
  }
  console.log('✅ .claude/ 가 .agent/ 원본과 동기화되어 있습니다.');
} else {
  const skillCount = [...desired.keys()].filter((p) => p.includes(`${path.sep}skills${path.sep}`)).length;
  const cmdCount = desired.size - skillCount;
  console.log(`✅ 동기화 완료 — 스킬 ${skillCount}개, 커맨드 ${cmdCount}개${drift.length ? ` (변경 ${drift.length}건)` : ' (변경 없음)'}`);
}
