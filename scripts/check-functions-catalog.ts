#!/usr/bin/env node
/**
 * check-functions-catalog — 함수 카탈로그·문서 수치가 코드와 어긋나지 않는지 검증한다.
 *
 * ## 왜 스크립트인가
 *
 * `docs/FUNCTIONS_REFERENCE.md`는 "자동 생성 문서"지만, 생성기
 * (scripts/generate-functions-doc.ts)의 입력이 **손으로 유지하는 배열**이다.
 * 그 배열에는 이런 주석만 있었다:
 *
 *   "정합성 확인: functions/src/index.ts의 export 목록과 이 배열의 name이 1:1이어야 한다"
 *
 * 확인하라는 말만 있고 확인하는 코드는 없었다. Phase 124가 이미 같은 실패를 겪었다 —
 * 그때 레퍼런스가 47개에 멈춰 누락 22개 + **존재하지 않는 7개**를 문서화하고 있었다.
 * README의 종류별 요약도 손으로 적은 숫자라 실제(67개)와 어긋난 채(63개) 남아 있었다.
 *
 * 그래서 세 가지를 기계로 대조한다:
 *   1. 카탈로그 ↔ functions/src/index.ts export  (1:1)
 *   2. README의 "전체 N개 함수"           ↔ 카탈로그 총계
 *   3. README 종류별 표의 개수            ↔ 카탈로그 타입별 집계
 *
 * 실행: npx tsx scripts/check-functions-catalog.ts
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const INDEX_TS = join(ROOT, 'functions/src/index.ts');
const GENERATOR = join(ROOT, 'scripts/generate-functions-doc.ts');
const README = join(ROOT, 'README.md');

// ── 1. index.ts의 export 이름 수집 ──
const indexSource = readFileSync(INDEX_TS, 'utf8');
const exported = new Set<string>();
for (const m of indexSource.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) exported.add(name);
    }
}
for (const m of indexSource.matchAll(/export\s+const\s+(\w+)/g)) exported.add(m[1]);

// ── 2. 생성기 카탈로그의 name/type 수집 ──
// interface 선언의 유니온 타입(`type: 'onCall' | 'onRequest' | ...`)이 아니라
// 엔트리의 `name:` 바로 뒤에 오는 `type:`만 짝지어 읽는다.
const generatorSource = readFileSync(GENERATOR, 'utf8');
const entries = [
    ...generatorSource.matchAll(/name:\s*'([A-Za-z0-9_]+)',\s*\n\s*type:\s*'([A-Za-z]+)'/g),
].map((m) => ({ name: m[1], type: m[2] }));
const catalog = new Set(entries.map((e) => e.name));

const problems: string[] = [];

const onlyIndex = [...exported].filter((n) => !catalog.has(n)).sort();
const onlyCatalog = [...catalog].filter((n) => !exported.has(n)).sort();
for (const n of onlyIndex) problems.push(`   카탈로그 누락: ${n} (index.ts에는 export되어 있음 → 레퍼런스에 안 나옴)`);
for (const n of onlyCatalog) problems.push(`   존재하지 않는 함수: ${n} (카탈로그에만 있음 → index.ts에 export 없음)`);

// ── 3. README 수치 대조 ──
const readme = readFileSync(README, 'utf8');
const total = entries.length;

const totalMatch = readme.match(/전체 (\d+)개 함수/);
if (!totalMatch) {
    problems.push('   README에서 "전체 N개 함수" 문구를 찾지 못했습니다 (문구가 바뀌었다면 이 스크립트도 갱신).');
} else if (Number(totalMatch[1]) !== total) {
    problems.push(`   README 총계 불일치: 문서 ${totalMatch[1]}개 vs 실제 ${total}개`);
}

// 종류별 집계 — README 표의 분류에 맞춰 Firestore 트리거는 onDocument* 를 합산한다.
const byType = new Map<string, number>();
for (const e of entries) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
const firestoreTriggers = [...byType.entries()]
    .filter(([t]) => t.startsWith('onDocument'))
    .reduce((sum, [, n]) => sum + n, 0);

const expectedRows: { label: string; pattern: RegExp; count: number }[] = [
    { label: '호출형 (onCall)', pattern: /\|\s*호출형 \(onCall\)\s*\|\s*(\d+)\s*\|/, count: byType.get('onCall') ?? 0 },
    { label: 'HTTP (onRequest)', pattern: /\|\s*HTTP \(onRequest\)\s*\|\s*(\d+)\s*\|/, count: byType.get('onRequest') ?? 0 },
    { label: '스케줄 (onSchedule)', pattern: /\|\s*스케줄 \(onSchedule\)\s*\|\s*(\d+)\s*\|/, count: byType.get('onSchedule') ?? 0 },
    { label: 'Firestore 트리거', pattern: /\|\s*Firestore 트리거\s*\|\s*(\d+)\s*\|/, count: firestoreTriggers },
    { label: 'Auth 트리거', pattern: /\|\s*Auth 트리거\s*\|\s*(\d+)\s*\|/, count: byType.get('onUserDeleted') ?? 0 },
];

for (const row of expectedRows) {
    const m = readme.match(row.pattern);
    if (!m) {
        problems.push(`   README 표에서 "${row.label}" 행을 찾지 못했습니다.`);
    } else if (Number(m[1]) !== row.count) {
        problems.push(`   README "${row.label}" 불일치: 문서 ${m[1]}개 vs 실제 ${row.count}개`);
    }
}

console.log('🔎 Cloud Functions 카탈로그·문서 수치 정합 검사');
console.log('═'.repeat(52));
console.log(`index.ts export: ${exported.size}개 / 카탈로그: ${catalog.size}개`);
console.log(`종류별: ${[...byType.entries()].sort().map(([t, n]) => `${t} ${n}`).join(', ')}`);
console.log('');

if (problems.length > 0) {
    console.error(`❌ 코드와 문서가 어긋납니다 (${problems.length}건)\n`);
    for (const p of problems) console.error(p);
    console.error('\n→ 카탈로그(scripts/generate-functions-doc.ts)와 README의 Cloud Functions 절을 맞추고,');
    console.error('  npx tsx scripts/generate-functions-doc.ts 로 레퍼런스를 재생성하세요.');
    process.exit(1);
}

console.log('✅ 카탈로그·README 모두 index.ts와 일치합니다.');
