/**
 * 하네스 Doctor — 에이전트 하네스(지침·스킬·워크플로·훅·eval)의 정합성을 한 번에 검사한다.
 *
 * 실행: npm run verify:harness  (= tsx scripts/check-harness.ts)
 *  - 차단 오류(error): 규칙 위반·깨진 참조 → exit 1
 *  - 경고(warn): 권고 위반·의심 패턴 → exit 0 유지, 출력만
 *
 * 검사 항목:
 *  1. Node 버전 정합 — engines / .node-version / CI 워크플로 / 현재 런타임(경고)
 *  2. AGENTS.md → .agent/agents.md 연결
 *  3. CLAUDE.md의 스킬 참조 실존 + 전체 스킬 테이블 포함 여부(경고)
 *  4. .agent/agents.md의 rules/ 링크 실존
 *  5. 스킬 frontmatter(name=디렉터리명, description 존재)
 *  6. 스킬 ↔ 워크플로 이름 충돌
 *  7. .agent ↔ .claude 브리지 동기화 (sync-claude-agents.ts --check)
 *  8. trigger eval — 전체 스킬 포함, id 중복, expected 유효성
 *  9. eval 베이스라인 구조 + provenance(측정일·모델·SHA·케이스 수·결과 해시)
 * 10. 워크플로 문서의 위험/구식 명령 패턴 (`npm test run`, PowerShell `&&`, 미존재 npm 스크립트)
 * 11. 추적되면 안 되는 개인 설정 파일 (.claude/settings.local.json 등)
 * 12. 하네스 문서의 깨진 상대 링크
 *
 * 단위 테스트: scripts/__tests__/check-harness.test.ts (파서·판정 함수)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface Finding {
    level: 'error' | 'warn';
    file: string;
    message: string;
}

// ── 순수 헬퍼 (단위 테스트 대상) ──────────────────────────────────────────────

/** 마크다운 상단 frontmatter에서 name/description을 추출한다. */
export function parseFrontmatter(content: string): { name?: string; description?: string } {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const pick = (key: string): string | undefined => {
        const line = m[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
        if (!line) return undefined;
        const v = line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
        return v.length ? v : undefined;
    };
    return { name: pick('name'), description: pick('description') };
}

/** 마크다운 본문에서 상대 경로 링크 대상을 추출한다 (http/앵커/메일 제외). */
export function extractRelativeLinks(content: string): string[] {
    const out: string[] = [];
    // 코드 블록 안 링크는 예시일 수 있으므로 제외
    const withoutCode = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    for (const m of withoutCode.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const target = m[1];
        if (/^(https?:|mailto:|#)/i.test(target)) continue;
        out.push(target.split('#')[0]);
    }
    return out.filter(Boolean);
}

/** results 객체의 정규화 해시 — 베이스라인 위·변조/드리프트 감지용. */
export function hashResults(results: Record<string, string>): string {
    const canonical = JSON.stringify(
        Object.keys(results).sort((a, b) => Number(a) - Number(b)).map((k) => [k, results[k]]),
    );
    return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/** PowerShell 코드 블록에서 PS 5.1이 지원하지 않는 `&&` 체이닝을 찾는다. */
export function findPwshChainingIssues(md: string): string[] {
    const issues: string[] = [];
    for (const m of md.matchAll(/```powershell\r?\n([\s\S]*?)```/g)) {
        for (const line of m[1].split(/\r?\n/)) {
            if (line.includes('&&')) issues.push(line.trim());
        }
    }
    return issues;
}

/** 문서에서 `npm run <script>` / `npm test run` 등 명령 참조를 추출한다. */
export function extractNpmRunScripts(md: string): string[] {
    const out: string[] = [];
    for (const m of md.matchAll(/npm(?:\.cmd)?\s+run\s+([A-Za-z0-9:._-]+)/g)) {
        out.push(m[1]);
    }
    return out;
}

// ── 검사 본체 ────────────────────────────────────────────────────────────────

function read(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf-8');
}

export function runChecks(root: string = ROOT): { findings: Finding[]; checked: number } {
    const findings: Finding[] = [];
    let checked = 0;
    const err = (file: string, message: string) => findings.push({ level: 'error', file, message });
    const warn = (file: string, message: string) => findings.push({ level: 'warn', file, message });

    // 1. Node 버전 정합
    checked++;
    const pkg = JSON.parse(read('package.json')) as {
        engines?: { node?: string };
        scripts?: Record<string, string>;
    };
    if (!pkg.engines?.node?.startsWith('22')) err('package.json', `engines.node가 22가 아님: ${pkg.engines?.node}`);
    const nodeVersionFile = read('.node-version').trim();
    if (!nodeVersionFile.startsWith('22')) err('.node-version', `22가 아님: ${nodeVersionFile}`);
    for (const wf of readdirSync(join(root, '.github', 'workflows')).filter((f) => f.endsWith('.yml'))) {
        const content = read(join('.github', 'workflows', wf));
        for (const m of content.matchAll(/node-version:\s*['"]?(\d+)/g)) {
            if (m[1] !== '22') err(`.github/workflows/${wf}`, `node-version ${m[1]} — 22여야 함`);
        }
    }
    const runtimeMajor = Number(process.versions.node.split('.')[0]);
    if (runtimeMajor !== 22) {
        warn('(런타임)', `현재 Node v${process.versions.node} — 빌드·테스트는 Node 22로: fnm exec --using=22 npm.cmd run <script>`);
    }

    // 2. AGENTS.md → .agent/agents.md 연결
    checked++;
    if (!read('AGENTS.md').includes('.agent/agents.md')) {
        err('AGENTS.md', '.agent/agents.md 참조가 없음 — Codex 진입점이 행동 헌법에 연결돼야 함');
    }

    // 3. CLAUDE.md 스킬 참조
    checked++;
    const claudeMd = read('CLAUDE.md');
    const skillDirs = readdirSync(join(root, '.agent', 'skills'), { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(root, '.agent', 'skills', d.name, 'SKILL.md')))
        .map((d) => d.name);
    for (const m of claudeMd.matchAll(/\.agent\/skills\/([\w-]+)\/SKILL\.md/g)) {
        if (!skillDirs.includes(m[1])) err('CLAUDE.md', `존재하지 않는 스킬 참조: ${m[1]}`);
    }
    for (const dir of skillDirs) {
        if (!claudeMd.includes(`.agent/skills/${dir}/`)) warn('CLAUDE.md', `스킬 테이블에 누락된 스킬: ${dir}`);
    }

    // 4. .agent/agents.md의 rules/ 링크
    checked++;
    const agentsMd = read(join('.agent', 'agents.md'));
    for (const m of agentsMd.matchAll(/\((?:\.\/)?(rules\/[\w-]+\.md)/g)) {
        if (!existsSync(join(root, '.agent', m[1]))) err('.agent/agents.md', `깨진 rules 링크: ${m[1]}`);
    }

    // 5. 스킬 frontmatter
    checked++;
    for (const dir of skillDirs) {
        const rel = join('.agent', 'skills', dir, 'SKILL.md');
        const fm = parseFrontmatter(read(rel));
        if (!fm.description) err(rel.replace(/\\/g, '/'), 'frontmatter description 없음 — 자동 발동 판정 근거가 사라짐');
        if (fm.name && fm.name !== dir) err(rel.replace(/\\/g, '/'), `frontmatter name(${fm.name})이 디렉터리명(${dir})과 다름`);
    }

    // 6. 스킬 ↔ 워크플로 이름 충돌
    checked++;
    const workflowNames = readdirSync(join(root, '.agent', 'workflows'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, ''));
    for (const dup of skillDirs.filter((s) => workflowNames.includes(s))) {
        err('.agent/', `스킬과 워크플로 이름 충돌: ${dup} — 자동 발동/슬래시 커맨드가 모호해짐`);
    }

    // 7. 브리지 동기화 (sync-claude-agents.ts --check)
    checked++;
    try {
        const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
        execFileSync(process.execPath, [tsxCli, join(root, 'scripts', 'sync-claude-agents.ts'), '--check'], {
            cwd: root,
            stdio: 'pipe',
        });
    } catch (e) {
        const out = e instanceof Error && 'stderr' in e ? String((e as { stderr: unknown }).stderr) : String(e);
        err('.claude/', `.agent ↔ .claude 브리지 드리프트 — npm run sync:agents 실행 필요\n${out.trim()}`);
    }

    // 8. trigger eval 커버리지
    checked++;
    const triggerEval = JSON.parse(read(join('scripts', 'skill-trigger-eval.json'))) as {
        cases: { id: number; prompt: string; expected: string }[];
    };
    const ids = triggerEval.cases.map((c) => c.id);
    const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupIds.length) err('scripts/skill-trigger-eval.json', `중복 case id: ${[...new Set(dupIds)].join(', ')}`);
    const expectedSet = new Set(triggerEval.cases.map((c) => c.expected));
    for (const exp of expectedSet) {
        if (exp !== 'none' && !skillDirs.includes(exp)) {
            err('scripts/skill-trigger-eval.json', `expected가 존재하지 않는 스킬: ${exp}`);
        }
    }
    for (const dir of skillDirs) {
        if (!expectedSet.has(dir)) err('scripts/skill-trigger-eval.json', `trigger eval에 포함되지 않은 스킬: ${dir}`);
    }

    // 9. eval 베이스라인 구조 + provenance
    checked++;
    const baselines = JSON.parse(read(join('scripts', 'eval-baselines.json'))) as Record<
        string,
        { score?: string; results?: Record<string, string>; provenance?: Record<string, unknown> } | string
    >;
    for (const kind of ['trigger', 'behavior'] as const) {
        const base = baselines[kind];
        if (!base || typeof base === 'string') {
            warn('scripts/eval-baselines.json', `${kind} 베이스라인 없음`);
            continue;
        }
        if (!base.results || !base.score) {
            err('scripts/eval-baselines.json', `${kind} 베이스라인에 score/results 누락`);
            continue;
        }
        const prov = base.provenance;
        const required = ['measuredAt', 'model', 'commitSha', 'caseCount', 'resultsHash'];
        const missing = required.filter((k) => !prov || prov[k] === undefined);
        if (missing.length) {
            err('scripts/eval-baselines.json', `${kind} 베이스라인 provenance 필드 누락: ${missing.join(', ')}`);
        } else if (prov) {
            if (prov.resultsHash !== hashResults(base.results)) {
                err('scripts/eval-baselines.json', `${kind} 베이스라인 resultsHash 불일치 — results가 provenance 기록 후 변경됨`);
            }
            if (prov.caseCount !== Object.keys(base.results).length) {
                warn('scripts/eval-baselines.json', `${kind} provenance caseCount(${prov.caseCount})와 results 수(${Object.keys(base.results).length}) 불일치`);
            }
        }
        if (kind === 'trigger') {
            const caseIds = new Set(ids.map(String));
            for (const rid of Object.keys(base.results)) {
                if (!caseIds.has(rid)) err('scripts/eval-baselines.json', `trigger 베이스라인에 eval에 없는 case id: ${rid}`);
            }
            const unmeasured = ids.filter((id) => !(String(id) in (base.results as object)));
            if (unmeasured.length) {
                warn('scripts/eval-baselines.json', `베이스라인 미측정 trigger 케이스: ${unmeasured.join(', ')} — 다음 eval 실행 시 baseline 갱신 필요`);
            }
        }
    }

    // 10. 워크플로 문서의 위험/구식 명령 패턴
    checked++;
    const rootScripts = new Set(Object.keys(pkg.scripts ?? {}));
    for (const wf of workflowNames) {
        const rel = `.agent/workflows/${wf}.md`;
        const md = read(join('.agent', 'workflows', `${wf}.md`));
        if (/npm\s+test\s+run\b/.test(md)) err(rel, '`npm test run`은 잘못된 명령 — `npm test`(= vitest run) 사용');
        for (const line of findPwshChainingIssues(md)) {
            warn(rel, `PowerShell 5.1은 &&를 지원하지 않음: "${line}"`);
        }
        // --prefix 등 다른 패키지 대상 실행은 제외하고 루트 스크립트만 검사
        for (const script of extractNpmRunScripts(md)) {
            if (!rootScripts.has(script)) warn(rel, `package.json에 없는 npm 스크립트 참조: ${script}`);
        }
    }

    // 11. 추적되면 안 되는 개인 설정 파일
    checked++;
    try {
        const tracked = execFileSync('git', ['ls-files', '.claude/settings.local.json', '.env', '.env.local'], {
            cwd: root,
            encoding: 'utf-8',
        })
            .split(/\r?\n/)
            .filter(Boolean);
        for (const f of tracked) {
            err(f, '개인/민감 설정 파일이 Git으로 추적됨 — git rm --cached 후 .gitignore에 추가');
        }
    } catch {
        warn('(git)', 'git ls-files 실행 실패 — 개인 설정 추적 검사 생략');
    }

    // 12. 하네스 문서의 깨진 상대 링크
    checked++;
    const mdFiles: string[] = ['AGENTS.md', 'CLAUDE.md', join('.agent', 'agents.md')];
    const collectMd = (dir: string) => {
        for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
            const rel = join(dir, entry.name);
            if (entry.isDirectory()) collectMd(rel);
            else if (entry.name.endsWith('.md')) mdFiles.push(rel);
        }
    };
    collectMd(join('.agent', 'rules'));
    collectMd(join('.agent', 'workflows'));
    collectMd(join('.agent', 'skills'));
    for (const rel of mdFiles) {
        const baseDir = dirname(join(root, rel));
        for (const link of extractRelativeLinks(read(rel))) {
            const target = resolve(baseDir, link);
            if (!target.startsWith(root + sep) && target !== root) continue; // 저장소 밖 링크는 판단 보류
            if (!existsSync(target)) {
                err(rel.replace(/\\/g, '/'), `깨진 상대 링크: ${link}`);
            }
        }
    }

    return { findings, checked };
}

function main(): void {
    const { findings, checked } = runChecks();
    const errors = findings.filter((f) => f.level === 'error');
    const warns = findings.filter((f) => f.level === 'warn');

    for (const f of findings) {
        const icon = f.level === 'error' ? '❌' : '⚠️ ';
        console.log(`${icon} [${f.file}] ${f.message}`);
    }
    console.log(
        `\n하네스 Doctor: 검사 ${checked}개 영역 — 오류 ${errors.length}건, 경고 ${warns.length}건${errors.length === 0 ? ' ✅' : ''}`,
    );
    if (errors.length > 0) {
        console.error('차단 오류가 있습니다. 위 항목을 수정한 뒤 다시 실행하세요: npm run verify:harness');
        process.exit(1);
    }
}

const selfPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === selfPath.toLowerCase()) {
    main();
}
