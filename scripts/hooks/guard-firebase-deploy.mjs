#!/usr/bin/env node
// PreToolUse(Bash|PowerShell) 훅: 로컬 `firebase deploy` 실행을 자동 승인에서 제외한다.
//
// 목적: CLAUDE.md 명령어 표의 "로컬에서 직접 실행 금지" 규칙을 에이전트의 기억이 아니라
// 하네스가 강제하게 만든다. 배포는 master 푸시 → CI(Deploy 워크플로) 단일 경로이며,
// 로컬 배포가 병행되면 동일 Cloud Function 동시 업데이트 충돌이 난다(2026-06-10 실사고).
//
// 동작:
//   - Bash/PowerShell 커맨드가 배포 실행을 담으면 permissionDecision "ask"로 강등
//     → 사용자가 직접 승인해야만 실행된다. (.claude/settings.json의 "npm run *" 등
//     allowlist보다 훅 판정이 우선하므로, 간접 실행도 자동 승인을 타지 못한다.)
//   - 감지 범위: firebase deploy 직접 실행(npx/firebase-tools/.cmd 변형 포함) +
//     npm 스크립트 간접 실행(`npm run deploy`, `npm --prefix functions run deploy`,
//     pnpm/yarn 변형 포함 — functions/package.json의 deploy 스크립트가 firebase deploy를 감쌈).
//   - 긴급 수동 배포(/deploy-functions 등)는 차단이 아니라 "사용자 승인 필수"로 통과 가능.
//   - 그 외 커맨드·파싱 실패는 개입하지 않는다(exit 0, 출력 없음).
//
// 단위 테스트: scripts/hooks/__tests__/guard-firebase-deploy.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// firebase deploy / firebase.cmd deploy / npx firebase deploy / npx -y firebase-tools deploy ...
const DIRECT_DEPLOY_RE =
  /(?:^|[\s;&|(])(?:npx(?:\.cmd)?\s+(?:-y\s+)?)?firebase(?:-tools)?(?:\.cmd)?\s+deploy\b/i;

// npm run deploy / npm.cmd run deploy:functions / npm --prefix functions run deploy /
// npm run deploy --prefix functions / pnpm run deploy / yarn [run] deploy ...
// 스크립트명은 정확히 deploy 또는 deploy:*만 매칭한다 (deploy-docs 같은 이름은 오탐 방지).
const NPM_SCRIPT_DEPLOY_RE =
  /(?:^|[\s;&|(])(?:npm|pnpm|yarn)(?:\.cmd)?\s+(?:(?:--prefix|--dir|-C)[=\s]+\S+\s+)?(?:run(?:-script)?\s+)?(?:(?:--prefix|--dir|-C)[=\s]+\S+\s+)?deploy(?::[\w-]+)?(?![\w:-])/i;

/**
 * 커맨드 문자열이 로컬 배포(직접/간접)를 담고 있는지 판별한다.
 * @param {unknown} command
 * @returns {boolean}
 */
export function isDeployCommand(command) {
  if (typeof command !== 'string') return false;
  if (DIRECT_DEPLOY_RE.test(command)) return true;
  // yarn은 run 없이도 스크립트를 실행하므로 `yarn deploy`도 NPM_SCRIPT_DEPLOY_RE가 잡는다
  // (run 그룹이 optional). npm은 `npm deploy`가 실제로 스크립트를 실행하지 않지만
  // 오탐 비용(사용자 승인 1회)이 미탐 비용(무중단 배포 충돌)보다 낮아 그대로 둔다.
  if (NPM_SCRIPT_DEPLOY_RE.test(command)) return true;
  return false;
}

function main() {
  let payload;
  try {
    // BOM 제거: PowerShell 파이프 등 일부 호출 경로가 UTF-8 BOM을 붙인다.
    payload = JSON.parse(readFileSync(0, 'utf8').replace(/^﻿/, ''));
  } catch {
    process.exit(0); // 훅 자체 오류로 커맨드를 막지 않는다.
  }

  const command = payload?.tool_input?.command;
  if (!isDeployCommand(command)) process.exit(0);

  // 주의: process.exit()는 파이프 stdout의 미기록 버퍼를 잘라먹을 수 있어(Windows),
  // 출력 후에는 자연 종료에 맡긴다.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason:
          '로컬 firebase deploy는 금지 경로입니다(CLAUDE.md 절대 규칙 — 배포는 master 푸시 → CI Deploy 워크플로 단일 경로, 병행 시 동일 함수 동시 업데이트 충돌). ' +
          '긴급 수동 배포라면 CI 미실행을 확인하고 Node 22 환경인지 점검한 뒤 직접 승인하세요.',
      },
    }),
  );
}

// 직접 실행(훅 호출)일 때만 stdin을 읽는다 — 테스트에서는 isDeployCommand만 import.
const selfPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === selfPath.toLowerCase()) {
  main();
}
