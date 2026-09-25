/**
 * 하네스 Doctor — 에이전트 하네스(지침·스킬·워크플로·훅)의 정합성을 한 번에 검사한다.
 *
 * 실행: npm run verify:harness  (= tsx scripts/check-harness.ts)
 *  - 차단 오류(error): 규칙 위반·깨진 참조 → exit 1
 *  - 경고(warn): 권고 위반·의심 패턴 → exit 0 유지, 출력만
 *
 * 검사 항목:
 * 번호는 도입 순서다(중간 번호는 차단 실적이 없어 2026-09-25에 걷어냈다).
 *  1. Node 버전 정합 — engines / .node-version / CI 워크플로 / 현재 런타임(경고)
 *  2. AGENTS.md → .agent/agents.md 연결
 *  7. .agent ↔ .claude 브리지 동기화 (sync-claude-agents.ts --check)
 * 11. 추적되면 안 되는 개인 설정 파일 (.claude/settings.local.json 등)
 * 12. 하네스 문서의 깨진 상대 링크
 * 13. Functions 레퍼런스 카탈로그 ↔ functions/src/index.ts export 정합 + 문서 총계
 * 14. 하네스 문서 본문의 인라인 백틱 경로·워크플로의 tsx/node 실행 대상 실존 — 규칙·스킬이
 *     코드 리팩터를 못 따라가 조용히 낡는 것을 막는다 (Phase 180에서 stale 경로 40여 건이 이 부재로 살아남았다)
 * 16. .claude/settings.json 훅 배선 실존 — 경로 오타 시 훅이 조용히 죽는 것을 막는다
 *
 * 단위 테스트: scripts/__tests__/check-harness.test.ts (파서·판정 함수)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
        // 실행 지시된 tsx/node 스크립트도 실제로 있어야 한다 — 없는 스크립트 실행 지시는 즉시 깨진다
        for (const scriptPath of extractScriptCommandPaths(read(rel))) {
            if (!existsSync(join(root, scriptPath))) {
                err(rel.replace(/\\/g, '/'), `존재하지 않는 스크립트 실행 지시: ${scriptPath}`);
            }
        }
        for (const token of extractInlineCodePaths(read(rel))) {
            if (!existsSync(join(root, token))) {
                err(rel.replace(/\\/g, '/'), `본문이 가리키는 경로가 존재하지 않음: \`${token}\` — 리팩터를 따라가지 못한 서술이거나 오타`);
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
