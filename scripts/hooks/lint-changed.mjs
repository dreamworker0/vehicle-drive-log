#!/usr/bin/env node
// PostToolUse(Edit|Write) 훅: 방금 수정된 소스 파일에 ESLint --fix를 자동 실행한다.
//
// 목적: agents.md §2 자동 교정 루프의 "Step 1: ESLint"를 에이전트의 기억이 아니라
// 하네스가 매 편집 직후 강제하게 만든다. 루트 eslint.config.js의 커스텀 보안 규칙
// local/require-organization-filter(=D10, 멀티테넌트 격리)까지 즉시 검사된다.
//
// 동작:
//   - 변경 파일이 린트 대상 확장자(.ts/.tsx/.js/.jsx/.mjs/.cjs)일 때만 실행
//   - eslint --fix로 자동 수정 가능한 위반은 조용히 정정
//   - 자동 수정 불가한 위반이 남으면 exit 2 + stderr로 에이전트에 피드백(차단)
//   - 그 외(파싱 실패·대상 외 파일·미존재)는 편집을 막지 않도록 exit 0
//
// 주의: tsc/build/test는 비용이 커 매 편집 훅에 넣지 않는다(§2.2 매트릭스대로 에이전트가
//       변경 범위에 맞춰 실행). 빌드는 Node 22 필수라 훅이 아니라 §2에서 다룬다.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LINTABLE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function done(code) {
  process.exit(code);
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  // 훅 자체 오류로 편집을 막지 않는다.
  done(0);
}

const filePath = payload?.tool_input?.file_path;
if (!filePath) done(0);

const abs = path.resolve(filePath);
// 레포 밖 파일은 대상 외(타 레포 동시 작업 등).
// Windows는 드라이브 문자 대소문자(d:\ vs D:\)·구분자가 달라질 수 있어 정규화 후 비교.
const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
if (!norm(abs).startsWith(norm(repoRoot) + '/')) done(0);
if (!LINTABLE.has(path.extname(abs))) done(0);

const eslintBin = path.join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js');

try {
  // --no-warn-ignored: dist/coverage 등 ignore 대상이면 조용히 통과
  execFileSync(process.execPath, [eslintBin, '--fix', '--no-warn-ignored', abs], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  done(0);
} catch (err) {
  const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
  if (!out) done(0); // 출력 없는 실패(예: eslint 미설치)는 차단하지 않음
  process.stderr.write(
    `[lint-changed] ESLint 위반이 남아 있습니다 (자동 수정 후 잔여). 수정 필요:\n${out}\n`,
  );
  done(2); // exit 2 → stderr가 에이전트에 피드백되어 교정 유도
}
