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
 *     + 신선도(측정 60일 경과 / 측정 커밋 이후 관련 원본 변경 — 경고)
 * 10. 워크플로 문서의 위험/구식 명령 패턴 (`npm test run`, PowerShell `&&`, 미존재 npm 스크립트,
 *     미존재 tsx/node 스크립트 경로) + frontmatter description 필수
 * 11. 추적되면 안 되는 개인 설정 파일 (.claude/settings.local.json 등)
 * 12. 하네스 문서의 깨진 상대 링크
 * 13. Functions 레퍼런스 카탈로그 ↔ functions/src/index.ts export 정합 + 문서 총계
 * 14. 하네스 문서 본문의 인라인 백틱 경로 실존 — 규칙·스킬이 코드 리팩터를 못 따라가
 *     조용히 낡는 것을 막는다 (Phase 180에서 stale 경로 40여 건이 이 부재로 살아남았다)
 * 15. gemini-pr-review.ts RULE_MAP ↔ .agent/rules/ 정합 — 리네임 시 리뷰 주입에서
 *     조용히 빠지는 것(오류) + 어디에도 매핑되지 않은 규칙(경고)
 * 16. .claude/settings.json 훅 배선 실존 — 경로 오타 시 훅이 조용히 죽는 것을 막는다
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

/** 14번 검사가 경로로 인정하는 저장소 루트 디렉터리. 이 밖의 토큰은 경로로 판정하지 않는다. */
const PATH_ROOTS = /^(?:src|functions|scripts|tests|docs|shared|public|e2e|\.agent|\.claude|\.github|\.husky)\//;

/** 실존 검사에서 제외할 경로 — gitignore 대상(CI 체크아웃에 없음)과 날짜 플레이스홀더. */
const PATH_CHECK_SKIP = [/(^|\/)\.env(\.|$)/, /settings\.local\.json$/, /YYYY/];

/**
 * 마크다운 본문의 인라인 백틱 코드에서 저장소 루트 기준 경로로 보이는 토큰을 뽑는다.
 * 펜스 코드 블록(```)은 가상의 예시 경로가 흔해 제외한다 — 실행 명령은 extractScriptCommandPaths가 본다.
 * `path.ts:12` 식 줄 번호 꼬리는 벗기고, 글롭·플레이스홀더(`*`·`{}`·`<>`)가 섞인 토큰은 경로로 보지 않는다.
 */
export function extractInlineCodePaths(md: string): string[] {
    const out: string[] = [];
    const withoutFences = md.replace(/```[\s\S]*?```/g, '');
    for (const m of withoutFences.matchAll(/`([^`\n]+)`/g)) {
        const token = m[1].trim().replace(/:\d+(?:[-–~:]\d+)?$/, '');
        if (!PATH_ROOTS.test(token)) continue;
        if (/[*{}<>()$'"\\|\s]/.test(token)) continue;
        if (PATH_CHECK_SKIP.some((re) => re.test(token))) continue;
        out.push(token.replace(/\/+$/, ''));
    }
    return out;
}

/**
 * 문서의 tsx/node 실행 명령에서 대상 스크립트 경로를 뽑는다.
 * 인라인 경로(14번)와 달리 펜스 코드 블록도 본다 — 워크플로의 명령 블록은 예시가 아니라 실행 지시다.
 * (Phase 180 감사에서 존재하지 않는 scripts/test-calendar-sync.ts 실행 지시가 이 검사 부재로 통과했다)
 */
export function extractScriptCommandPaths(md: string): string[] {
    const out: string[] = [];
    for (const m of md.matchAll(/(?:npx\s+)?\btsx\s+((?:scripts|functions)\/[\w./-]+\.ts)\b/g)) out.push(m[1]);
    for (const m of md.matchAll(/\bnode\s+((?:scripts|\.claude)\/[\w./-]+\.(?:mjs|cjs|js))\b/g)) out.push(m[1]);
    return out;
}

/**
 * 소스에서 따옴표로 감싼 규칙 파일 참조를 뽑는다 (gemini-pr-review.ts RULE_MAP 정합 검사용).
 * 규칙 파일명은 소문자 케밥 컨벤션이다 — CLAUDE.md 같은 비규칙 문서 참조는 제외한다.
 */
export function extractQuotedMdRefs(src: string): string[] {
    return [...new Set([...src.matchAll(/['"]([a-z][a-z0-9-]*\.md)['"]/g)].map((m) => m[1]))];
}

/** .claude/settings.json의 훅 명령 문자열에서 로컬 스크립트 경로를 뽑는다. */
export function extractHookScriptPaths(settingsJson: string): string[] {
    const out: string[] = [];
    const settings = JSON.parse(settingsJson) as {
        hooks?: Record<string, { hooks?: { command?: string }[] }[]>;
    };
    for (const groups of Object.values(settings.hooks ?? {})) {
        for (const group of groups) {
            for (const h of group.hooks ?? []) {
                if (!h.command) continue;
                for (const m of h.command.matchAll(
                    /(?:\$CLAUDE_PROJECT_DIR\/)?((?:scripts|\.claude)\/[\w./-]+\.(?:mjs|cjs|js|sh))/g,
                )) {
                    out.push(m[1]);
                }
            }
        }
    }
    return out;
}

/**
 * functions/src/index.ts의 export 이름을 뽑는다.
 * `export { a } from "..."` / `export { a, b } from "..."` / 여러 줄 형태를 모두 처리하고,
 * `x as y` 별칭은 실제 배포 이름인 `y`를 취한다.
 */
export function extractFunctionExports(src: string): string[] {
    const out: string[] = [];
    for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
        for (const raw of m[1].split(',')) {
            const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
            if (name) out.push(name);
        }
    }
    return out;
}

/**
 * generate-functions-doc.ts 카탈로그의 함수 이름을 뽑는다.
 * 따옴표 스타일(작은/큰/백틱)에 의존하지 않는다 — 스타일이 바뀌면 파서가 빈 배열을 내고
 * 13번 검사가 "전부 누락"으로 오탐해 CI를 잘못 막기 때문이다.
 */
export function extractCatalogNames(src: string): string[] {
    return [...src.matchAll(/^\s*name:\s*['"`]([A-Za-z0-9_]+)['"`]/gm)].map((m) => m[1]);
}

/** 카탈로그 ↔ index.ts export 드리프트 판정 (13번 검사 본체가 그대로 쓰는 순수 함수). */
export function diffCatalogNames(
    exported: string[],
    catalog: string[],
): { missing: string[]; stale: string[]; duplicates: string[] } {
    const catalogSet = new Set(catalog);
    const exportedSet = new Set(exported);
    return {
        missing: exported.filter((n) => !catalogSet.has(n)),
        stale: catalog.filter((n) => !exportedSet.has(n)),
        duplicates: [...new Set(catalog.filter((n, i) => catalog.indexOf(n) !== i))],
    };
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
            // 신선도 — 베이스라인은 회귀 기준선이라 낡아도 아무도 알려주지 않는다. 두 신호로 경고한다:
            // (a) 측정일이 60일 경과, (b) 측정 커밋 이후 판정에 영향을 주는 원본이 변경됨.
            const measuredAt = String(prov.measuredAt);
            const ageDays = Math.floor((Date.now() - Date.parse(measuredAt)) / 86_400_000);
            if (Number.isFinite(ageDays) && ageDays > 60) {
                warn('scripts/eval-baselines.json', `${kind} 베이스라인 측정 후 ${ageDays}일 경과 — 재측정 권장 (npm run eval:${kind})`);
            }
            const watchPaths =
                kind === 'trigger'
                    ? ['.agent/skills', 'scripts/skill-trigger-eval.json']
                    : ['.agent/rules', '.agent/agents.md', 'scripts/behavior-rule-eval.json'];
            try {
                // 얕은 클론 등으로 측정 커밋이 로컬에 없으면 이 신호는 조용히 생략한다 (날짜 경고가 하한선).
                execFileSync('git', ['cat-file', '-e', `${String(prov.commitSha)}^{commit}`], { cwd: root, stdio: 'pipe' });
                const changed = execFileSync(
                    'git',
                    ['diff', '--name-only', String(prov.commitSha), 'HEAD', '--', ...watchPaths],
                    { cwd: root, encoding: 'utf-8' },
                )
                    .split(/\r?\n/)
                    .filter(Boolean);
                if (changed.length) {
                    warn(
                        'scripts/eval-baselines.json',
                        `${kind} 측정(${measuredAt}, ${String(prov.commitSha).slice(0, 7)}) 이후 관련 원본 ${changed.length}개 변경 — 재측정 권장 (npm run eval:${kind})`,
                    );
                }
            } catch {
                /* 측정 커밋 미해석·git 부재 — 변경 감지 생략 */
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

    // 10. 워크플로 문서의 위험/구식 명령 패턴 + frontmatter
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
        // 실행 지시된 tsx/node 스크립트가 실제로 있어야 한다 — 없는 스크립트 실행 지시는 즉시 깨진다
        for (const scriptPath of extractScriptCommandPaths(md)) {
            if (!existsSync(join(root, scriptPath))) err(rel, `존재하지 않는 스크립트 실행 지시: ${scriptPath}`);
        }
        // description이 없으면 브리지가 H1 제목으로 조용히 대체해 슬래시 커맨드 품질 저하가 드러나지 않는다
        if (!parseFrontmatter(md).description) err(rel, 'frontmatter description 없음 — 슬래시 커맨드 안내가 H1 폴백으로 조용히 대체됨');
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

    // 14. 하네스 문서 본문의 인라인 백틱 경로 실존
    // 규칙·스킬 본문이 가리키는 경로가 리팩터로 사라져도 링크 검사(12)는 침묵한다 —
    // Phase 180 감사에서 stale 경로 40여 건이 전부 이 부재로 살아남았다.
    checked++;
    for (const rel of mdFiles) {
        for (const token of extractInlineCodePaths(read(rel))) {
            if (!existsSync(join(root, token))) {
                err(rel.replace(/\\/g, '/'), `본문이 가리키는 경로가 존재하지 않음: \`${token}\` — 리팩터를 따라가지 못한 서술이거나 오타`);
            }
        }
    }

    // 15. gemini-pr-review.ts RULE_MAP ↔ .agent/rules/ 정합
    // RULE_MAP은 규칙 파일명을 문자열로 참조한다 — 리네임하면 리뷰 프롬프트에서 조용히 빠진다.
    checked++;
    const reviewSrc = read(join('scripts', 'gemini-pr-review.ts'));
    const ruleRefs = extractQuotedMdRefs(reviewSrc);
    const ruleFiles = readdirSync(join(root, '.agent', 'rules')).filter((f) => f.endsWith('.md'));
    if (ruleRefs.length === 0) {
        // 파서가 통째로 실패하면(형식 변경) 전부 미매핑으로 오탐한다 — 파서 고장으로 구분해 보고 (13번과 동일 원칙)
        err('scripts/check-harness.ts', '15번 검사 파서가 RULE_MAP에서 규칙 참조를 하나도 찾지 못함 — 드리프트가 아니라 파서·파일 형식 문제');
    } else {
        for (const ref of ruleRefs) {
            if (!ruleFiles.includes(ref)) {
                err('scripts/gemini-pr-review.ts', `RULE_MAP이 존재하지 않는 규칙을 참조: ${ref} — 규칙 리네임 시 여기도 함께 고쳐야 리뷰 주입이 유지됨`);
            }
        }
        // 프로세스·메타 규칙은 PR diff 경로에 대응물이 없어 의도적으로 미매핑이다.
        const UNMAPPED_OK = new Set(['commit-message.md', 'pre-commit.md', 'multi-agent-coordination.md', 'planning-scope-review.md']);
        for (const f of ruleFiles) {
            if (!ruleRefs.includes(f) && !UNMAPPED_OK.has(f)) {
                warn('scripts/gemini-pr-review.ts', `어떤 변경 경로에도 매핑되지 않은 규칙: ${f} — RULE_MAP에 추가하거나, 의도적이면 check-harness.ts의 UNMAPPED_OK에 등록`);
            }
        }
    }

    // 16. .claude/settings.json 훅 배선 실존 — 경로 오타 시 훅이 조용히 죽는다
    checked++;
    try {
        for (const hookPath of extractHookScriptPaths(read(join('.claude', 'settings.json')))) {
            if (!existsSync(join(root, hookPath))) {
                err('.claude/settings.json', `훅이 가리키는 스크립트가 존재하지 않음: ${hookPath}`);
            }
        }
    } catch (e) {
        // 파일이 깨진 JSON(BOM 등)이면 스택트레이스로 죽는 대신 파서 고장으로 보고한다 (13·15번과 동일 원칙)
        err('.claude/settings.json', `16번 검사가 settings.json을 파싱하지 못함 — ${e instanceof Error ? e.message : String(e)}`);
    }

    // 13. Functions 레퍼런스 카탈로그 ↔ index.ts export 정합
    // 카탈로그가 수동 배열이라 함수를 추가·삭제하면 문서가 조용히 낡는다(Phase 124에서 47 vs 63으로 벌어져 있었다).
    checked++;
    const catalogNames = extractCatalogNames(read(join('scripts', 'generate-functions-doc.ts')));
    const exportedNames = extractFunctionExports(read(join('functions', 'src', 'index.ts')));
    // 파서가 통째로 실패하면(형식 변경 등) 전 함수 누락으로 오탐해 CI를 잘못 막는다 — 파서 고장으로 구분해 보고한다.
    if (catalogNames.length === 0 || exportedNames.length === 0) {
        err(
            'scripts/check-harness.ts',
            `13번 검사 파서가 아무것도 찾지 못함 (카탈로그 ${catalogNames.length}건 / export ${exportedNames.length}건) — 드리프트가 아니라 파서·파일 형식 문제`,
        );
    } else {
        const { missing, stale, duplicates } = diffCatalogNames(exportedNames, catalogNames);
        for (const name of missing) {
            err('scripts/generate-functions-doc.ts', `카탈로그에 없는 배포 함수: ${name} — 항목 추가 후 npx tsx scripts/generate-functions-doc.ts`);
        }
        for (const name of stale) {
            err('scripts/generate-functions-doc.ts', `index.ts에서 export되지 않는 카탈로그 항목: ${name} — 삭제된 함수라면 항목 제거`);
        }
        if (duplicates.length) {
            err('scripts/generate-functions-doc.ts', `카탈로그 중복 항목: ${duplicates.join(', ')}`);
        }
        // 카탈로그를 고쳤지만 재생성을 잊은 경우 — 생성 문서의 총계가 어긋난다.
        // 파서가 고장난 경우(위 분기)에는 검사하지 않는다 — 총계 0 대비로 어긋나 원인을 흐린다.
        const refTotal = /총 함수 수: \*\*(\d+)개\*\*/.exec(read(join('docs', 'FUNCTIONS_REFERENCE.md')))?.[1];
        if (refTotal === undefined) {
            warn('docs/FUNCTIONS_REFERENCE.md', '총 함수 수 표기를 찾지 못함 — 생성기 출력 형식이 바뀐 것인지 확인');
        } else if (Number(refTotal) !== catalogNames.length) {
            err('docs/FUNCTIONS_REFERENCE.md', `문서 총계(${refTotal})와 카탈로그 항목 수(${catalogNames.length}) 불일치 — npx tsx scripts/generate-functions-doc.ts 재실행 필요`);
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
