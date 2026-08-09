#!/usr/bin/env node
/**
 * check-functions-env — functions/.env 문서가 코드와 어긋나지 않는지 검증한다.
 *
 * ## 왜 스크립트인가
 *
 * 이 저장소의 문서 드리프트는 예외 없이 "사람이 손으로 유지하는 목록"에서 났다.
 * README의 `functions/.env` 예시(9개)와 `functions/.env.example`(5개)가 공통 키
 * 2개만 겹친 채 서로 다른 진실을 말하고 있었고, 그 결과:
 *   - README에만 있던 EMAILJS_SERVICE_ID/TEMPLATE_ID/PUBLIC_KEY는 사실 코드에
 *     하드코딩된 상수였다(services/driveLog/verifyHelpers.ts) — env가 아니다.
 *   - .env.example에만 있던 SENTRY_DSN_FUNCTIONS는 README를 따라 설정하면 빠지는데,
 *     이 값이 없으면 Cloud Functions 예외 알림이 한 건도 나가지 않았다.
 * 어느 쪽을 고쳐도 다음에 또 어긋난다. 그래서 **코드를 단일 원본으로 삼아** 두 문서를
 * 대조한다.
 *
 * ## 판정 방법
 *
 * functions/src에서 평문 환경변수 사용처를 수집한다:
 *   - `defineString("NAME")`      — Functions 파라미터
 *   - `process.env.NAME`          — 직접 읽기
 * 여기서 런타임 제공값(GCLOUD_PROJECT 등)과 Secret Manager 관리분(params.ts의
 * defineSecret + 그 값이 런타임에 process.env로 주입되는 것)을 제외한 나머지가
 * `functions/.env`에 들어가야 하는 키다.
 *
 * 실행: npx tsx scripts/check-functions-env.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const FUNCTIONS_SRC = join(ROOT, 'functions/src');
const ENV_EXAMPLE = join(ROOT, 'functions/.env.example');
const README = join(ROOT, 'README.md');

/**
 * Cloud Functions 런타임이 자동으로 넣어주는 값 — .env에 적지 않는다.
 * 에뮬레이터 호스트는 firebase emulators:exec가 주입한다.
 */
const RUNTIME_PROVIDED = new Set([
    'GCLOUD_PROJECT',
    'GCP_PROJECT',
    'NODE_ENV',
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIRESTORE_EMULATOR_HOST',
]);

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') continue;
            walk(full, out);
        } else if (entry.endsWith('.ts')) {
            out.push(full);
        }
    }
    return out;
}

const files = walk(FUNCTIONS_SRC);

// Secret Manager 관리분 — params.ts의 defineSecret이 단일 원본이다.
// 시크릿은 런타임에 process.env로 주입되므로 아래 수집에서 반드시 걸러내야 한다.
const paramsSource = readFileSync(join(FUNCTIONS_SRC, 'core/params.ts'), 'utf8');
const secrets = new Set(
    [...paramsSource.matchAll(/defineSecret\("([A-Z0-9_]+)"\)/g)].map((m) => m[1]),
);

const used = new Map<string, string[]>(); // 키 → 사용 파일(상대경로)
for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const rel = file.slice(ROOT.length + 1);
    const names = [
        ...[...source.matchAll(/defineString\("([A-Z0-9_]+)"/g)].map((m) => m[1]),
        ...[...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]),
    ];
    for (const name of names) {
        if (RUNTIME_PROVIDED.has(name) || secrets.has(name)) continue;
        const seen = used.get(name) ?? [];
        if (!seen.includes(rel)) seen.push(rel);
        used.set(name, seen);
    }
}

const expected = [...used.keys()].sort();

// .env.example의 키 (주석·빈 줄 제외)
const exampleKeys = [
    ...readFileSync(ENV_EXAMPLE, 'utf8').matchAll(/^([A-Z0-9_]+)=/gm),
].map((m) => m[1]).sort();

// README의 functions/.env 코드블록에서 키 추출.
// 블록을 찾지 못하면 통과시키지 않고 실패한다 — 문서 구조가 바뀌었는데 검사만
// 조용히 비활성화되는 것이 이 스크립트가 막으려는 실패 그 자체다(fail-closed).
const readme = readFileSync(README, 'utf8');
const blockMatch = readme.match(/`functions\/\.env`[^\n]*\n+```env\n([\s\S]*?)```/);
if (!blockMatch) {
    console.error('❌ README.md에서 `functions/.env` env 코드블록을 찾지 못했습니다.');
    console.error('   문서 구조가 바뀌었다면 이 스크립트의 정규식도 함께 갱신하세요.');
    process.exit(1);
}
const readmeKeys = [...blockMatch[1].matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]).sort();

function diff(label: string, actual: string[]): string[] {
    const missing = expected.filter((k) => !actual.includes(k));
    const extra = actual.filter((k) => !expected.includes(k));
    const problems: string[] = [];
    for (const k of missing) {
        problems.push(`   [${label}] 누락: ${k}  (사용처: ${used.get(k)!.join(', ')})`);
    }
    for (const k of extra) {
        problems.push(`   [${label}] 코드에서 쓰이지 않음: ${k}`);
    }
    return problems;
}

const problems = [...diff('.env.example', exampleKeys), ...diff('README.md', readmeKeys)];

console.log('🔎 functions 환경변수 문서 정합 검사');
console.log('═'.repeat(52));
console.log(`코드가 요구하는 평문 키: ${expected.length}개`);
for (const k of expected) console.log(`   · ${k}`);
console.log(`Secret Manager 관리(제외): ${[...secrets].sort().join(', ')}`);
console.log('');

if (problems.length > 0) {
    console.error(`❌ 문서와 코드가 어긋납니다 (${problems.length}건)\n`);
    for (const p of problems) console.error(p);
    console.error('\n→ functions/.env.example과 README.md의 `functions/.env` 블록을 코드에 맞추세요.');
    process.exit(1);
}

console.log('✅ .env.example · README.md 모두 코드와 일치합니다.');
