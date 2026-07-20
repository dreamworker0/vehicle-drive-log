/**
 * 하네스 eval 러너 — 트리거/행동 회귀 세트의 "결정론적 80%"를 담당한다.
 *
 * 두 eval 모두 본질적으로 LLM 판정이 필요하다(트리거=카탈로그 블라인드 매칭,
 * 행동=fresh 에이전트 실행 후 판정). 그래서 이 스크립트는 *판정 자체*를 하지 않고,
 * 운영자(Claude Code 에이전트)가 판정하기 쉽도록:
 *   1) emit     — 블라인드 프롬프트를 자동 조립해 출력
 *   2) score    — 판정 결과 파일을 expected와 대조해 채점 + 베이스라인 대비 회귀 diff (회귀 시 exit 1)
 *   3) baseline — 현재 결과를 새 베이스라인으로 저장
 *
 * 사용:
 *   npm run eval:trigger                      # = emit (블라인드 프롬프트 출력)
 *   npm run eval:trigger -- score results.json
 *   npm run eval:trigger -- baseline results.json
 *   npm run eval:behavior                     # = emit
 *   npm run eval:behavior -- score results.json
 *
 * 결과 파일 형식(JSON, case id → 판정):
 *   트리거: { "1": "firestore-model-pattern", "2": "firestore-query-optimization", ... }
 *   행동:   { "1": "pass", "9": "fail", ... }   // 모든 케이스의 기대 결과는 pass
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashResults } from './check-harness';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(ROOT, '.agent', 'skills');
const BASELINE_FILE = join(ROOT, 'scripts', 'eval-baselines.json');
const EVAL_FILES = {
  trigger: join(ROOT, 'scripts', 'skill-trigger-eval.json'),
  behavior: join(ROOT, 'scripts', 'behavior-rule-eval.json'),
} as const;

type Kind = keyof typeof EVAL_FILES;

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

/** .agent/skills/*\/SKILL.md 프론트매터에서 name+description 카탈로그를 만든다. */
function loadSkillCatalog(): { name: string; description: string }[] {
  const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  const out: { name: string; description: string }[] = [];
  for (const d of dirs) {
    const file = join(SKILLS_DIR, d.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf-8');
    const fm = text.match(/^---\s*\n([\s\S]*?)\n---/);
    const block = fm ? fm[1] : '';
    const unquote = (s: string) => s.trim().replace(/^["'](.*)["']$/, '$1').trim();
    const name = unquote(block.match(/^name:\s*(.+)$/m)?.[1] ?? d.name);
    const description = unquote(block.match(/^description:\s*(.+)$/m)?.[1] ?? '(설명 없음)');
    out.push({ name, description });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ── emit ─────────────────────────────────────────────────────────────────────

function emitTrigger(): void {
  const evalSet = readJson<{ cases: { id: number; prompt: string }[] }>(EVAL_FILES.trigger);
  const catalog = loadSkillCatalog();
  console.log(`${C.bold}# 스킬 트리거 블라인드 판정${C.reset}\n`);
  console.log(
    '아래 스킬 카탈로그(name + description)만 보고, 각 프롬프트에 대해 자동 발동되어야 할 스킬 1개를 고르라.\n' +
    '카탈로그에 없는 이름을 지어내지 말 것. 어떤 스킬도 맞지 않으면 "none".\n' +
    `최종 출력은 JSON 한 덩어리: { "<id>": "<skill-name>", ... } (${evalSet.cases.length}개 전부).\n`,
  );
  console.log(`${C.bold}## 카탈로그 (${catalog.length}개)${C.reset}`);
  for (const s of catalog) console.log(`- ${s.name}: ${s.description}`);
  console.log(`\n${C.bold}## 프롬프트 (${evalSet.cases.length}개)${C.reset}`);
  for (const c of evalSet.cases) console.log(`${c.id}. ${c.prompt}`);
  console.log(`\n${C.dim}→ 판정 후 결과를 results.json에 저장하고: npm run eval:trigger -- score results.json${C.reset}`);
}

function emitBehavior(): void {
  type Case = { id: number; rule: string; kind: string; prompt: string; trap: string; pass: string; expect: string };
  const evalSet = readJson<{ cases: Case[] }>(EVAL_FILES.behavior);
  console.log(`${C.bold}# 행동 규칙 준수 판정 (fresh 에이전트 실행 필요)${C.reset}\n`);
  console.log(
    '각 프롬프트를 규칙을 언급하지 않은 채 깨끗한 서브에이전트에 그대로 던져 코드를 받은 뒤,\n' +
    'trap에 빠졌는지/pass를 만족하는지 블라인드로 판정하라. 모든 케이스의 기대 결과는 "pass".\n' +
    `최종 출력은 JSON: { "<id>": "pass" | "fail", ... } (${evalSet.cases.length}개 전부).\n`,
  );
  for (const c of evalSet.cases) {
    console.log(`${C.bold}${c.id}. [${c.rule}/${c.kind}]${C.reset} ${c.prompt}`);
    console.log(`   ${C.dim}trap:${C.reset} ${c.trap}`);
    console.log(`   ${C.dim}pass:${C.reset} ${c.pass}\n`);
  }
  console.log(`${C.dim}→ 판정 후 결과를 results.json에 저장하고: npm run eval:behavior -- score results.json${C.reset}`);
}

// ── score ────────────────────────────────────────────────────────────────────

type CaseResult = { id: number; ok: boolean; got: string; want: string };

function scoreTrigger(results: Record<string, string>): CaseResult[] {
  const evalSet = readJson<{ cases: { id: number; expected: string }[] }>(EVAL_FILES.trigger);
  return evalSet.cases.map((c) => {
    const got = (results[String(c.id)] ?? '(누락)').trim();
    return { id: c.id, ok: got === c.expected, got, want: c.expected };
  });
}

function scoreBehavior(results: Record<string, string>): CaseResult[] {
  const evalSet = readJson<{ cases: { id: number }[] }>(EVAL_FILES.behavior);
  // 행동 eval은 모든 케이스의 기대 결과가 "pass"다(위반유도=준수, 음성=과잉적용 안 함).
  return evalSet.cases.map((c) => {
    const got = (results[String(c.id)] ?? '(누락)').trim().toLowerCase();
    return { id: c.id, ok: got === 'pass', got, want: 'pass' };
  });
}

function score(kind: Kind, resultsPath: string): void {
  if (!existsSync(resultsPath)) {
    console.error(`${C.red}결과 파일 없음:${C.reset} ${resultsPath}`);
    process.exit(2);
  }
  const results = readJson<Record<string, string>>(resultsPath);
  const rows = kind === 'trigger' ? scoreTrigger(results) : scoreBehavior(results);
  const correct = rows.filter((r) => r.ok).length;

  console.log(`${C.bold}# ${kind} eval 채점${C.reset}\n`);
  for (const r of rows) {
    const mark = r.ok ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    const detail = r.ok ? `${C.dim}${r.got}${C.reset}` : `got=${C.red}${r.got}${C.reset} want=${C.green}${r.want}${C.reset}`;
    console.log(`  ${mark} #${r.id}  ${detail}`);
  }
  const pct = ((correct / rows.length) * 100).toFixed(0);
  console.log(`\n${C.bold}점수: ${correct}/${rows.length} (${pct}%)${C.reset}`);

  // 베이스라인 대비 회귀 diff
  const baselines = existsSync(BASELINE_FILE) ? readJson<Record<string, { results: Record<string, string> }>>(BASELINE_FILE) : {};
  const base = baselines[kind]?.results;
  if (!base) {
    console.log(`${C.yellow}베이스라인 없음 — npm run eval:${kind} -- baseline ${resultsPath} 로 저장 가능${C.reset}`);
    return;
  }
  const baseRows = kind === 'trigger' ? scoreTrigger(base) : scoreBehavior(base);
  const baseOk = new Set(baseRows.filter((r) => r.ok).map((r) => r.id));
  const nowOk = new Set(rows.filter((r) => r.ok).map((r) => r.id));
  const regressions = [...baseOk].filter((id) => !nowOk.has(id));
  const fixes = [...nowOk].filter((id) => !baseOk.has(id));

  if (fixes.length) console.log(`${C.green}개선: ${fixes.map((i) => `#${i}`).join(', ')}${C.reset}`);
  if (regressions.length) {
    console.log(`${C.red}${C.bold}회귀: ${regressions.map((i) => `#${i}`).join(', ')} — 베이스라인에서 통과하던 케이스가 깨짐${C.reset}`);
    process.exit(1);
  }
  if (!fixes.length) console.log(`${C.dim}베이스라인 대비 변화 없음${C.reset}`);
}

// ── baseline ───────────────────────────────────────────────────────────────────

interface BaselineEntry {
  score: string;
  provenance: {
    measuredAt: string;   // 측정일 (YYYY-MM-DD)
    model: string;        // 판정에 사용한 모델
    commitSha: string;    // 측정 시점 커밋
    caseCount: number;    // 측정된 케이스 수
    resultsHash: string;  // results 정규화 해시 (사후 변조/드리프트 감지)
  };
  results: Record<string, string>;
}

/** --model=X 또는 EVAL_MODEL 환경변수에서 모델명을 얻는다. 없으면 저장을 거부한다. */
function resolveModel(): string {
  const arg = process.argv.find((a) => a.startsWith('--model='));
  const model = arg ? arg.slice('--model='.length) : process.env.EVAL_MODEL;
  if (!model) {
    console.error(`${C.red}모델명이 필요합니다.${C.reset} --model=<판정 모델> 또는 EVAL_MODEL 환경변수로 지정하세요.`);
    console.error('예: npm run eval:trigger -- baseline results.json --model=claude-fable-5');
    process.exit(2);
  }
  return model;
}

function currentCommitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function saveBaseline(kind: Kind, resultsPath: string): void {
  if (!existsSync(resultsPath)) {
    console.error(`${C.red}결과 파일 없음:${C.reset} ${resultsPath}`);
    process.exit(2);
  }
  const model = resolveModel();
  const results = readJson<Record<string, string>>(resultsPath);
  const baselines = existsSync(BASELINE_FILE)
    ? readJson<Record<string, unknown> & { history?: unknown[] }>(BASELINE_FILE)
    : {};
  const rows = kind === 'trigger' ? scoreTrigger(results) : scoreBehavior(results);
  const correct = rows.filter((r) => r.ok).length;

  // 기존 베이스라인은 조용히 덮어쓰지 않고 history로 보존한다 (최근 5개).
  const prev = baselines[kind] as BaselineEntry | undefined;
  if (prev?.results) {
    const history = Array.isArray(baselines.history) ? baselines.history : [];
    history.push({ kind, ...prev });
    baselines.history = history.slice(-5);
  }

  const entry: BaselineEntry = {
    score: `${correct}/${rows.length}`,
    provenance: {
      measuredAt: new Date().toISOString().slice(0, 10),
      model,
      commitSha: currentCommitSha(),
      caseCount: Object.keys(results).length,
      resultsHash: hashResults(results),
    },
    results,
  };
  baselines[kind] = entry;
  writeFileSync(BASELINE_FILE, JSON.stringify(baselines, null, 2) + '\n', 'utf-8');
  console.log(`${C.green}베이스라인 저장:${C.reset} ${kind} = ${correct}/${rows.length} (${model}, ${entry.provenance.measuredAt}) → ${BASELINE_FILE}`);
}

// ── main ───────────────────────────────────────────────────────────────────────

function main(): void {
  const [kindArg, action = 'emit', resultsPath] = process.argv.slice(2);
  if (kindArg !== 'trigger' && kindArg !== 'behavior') {
    console.error('사용: tsx scripts/run-eval.ts <trigger|behavior> [emit|score|baseline] [results.json]');
    process.exit(2);
  }
  const kind = kindArg as Kind;
  switch (action) {
    case 'emit':
      if (kind === 'trigger') emitTrigger();
      else emitBehavior();
      break;
    case 'score':
      if (!resultsPath) { console.error('score 에는 결과 파일 경로가 필요'); process.exit(2); }
      score(kind, resultsPath);
      break;
    case 'baseline':
      if (!resultsPath) { console.error('baseline 에는 결과 파일 경로가 필요'); process.exit(2); }
      saveBaseline(kind, resultsPath);
      break;
    default:
      console.error(`알 수 없는 action: ${action}`);
      process.exit(2);
  }
}

main();
