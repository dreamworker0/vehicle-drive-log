#!/usr/bin/env node
// PreToolUse(Bash|PowerShell) 훅: 로컬 `firebase deploy` 실행을 자동 승인에서 제외한다.
//
// 목적: CLAUDE.md 명령어 표의 "로컬에서 직접 실행 금지" 규칙을 에이전트의 기억이 아니라
// 하네스가 강제하게 만든다. 배포는 master 푸시 → CI(Deploy 워크플로) 단일 경로이며,
// 로컬 배포가 병행되면 동일 Cloud Function 동시 업데이트 충돌이 난다(2026-06-10 실사고).
//
// 동작:
//   - Bash/PowerShell 커맨드가 `firebase deploy`(npx/firebase-tools/.cmd 변형 포함)를 담으면
//     permissionDecision "ask"로 강등 → 사용자가 직접 승인해야만 실행된다.
//   - 긴급 수동 배포(/deploy-functions 등)는 차단이 아니라 "사용자 승인 필수"로 통과 가능.
//   - 그 외 커맨드·파싱 실패는 개입하지 않는다(exit 0, 출력 없음).

import { readFileSync } from 'node:fs';

let payload;
try {
  // BOM 제거: PowerShell 파이프 등 일부 호출 경로가 UTF-8 BOM을 붙인다.
  payload = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
} catch {
  process.exit(0); // 훅 자체 오류로 커맨드를 막지 않는다.
}

const command = payload?.tool_input?.command;
if (typeof command !== 'string') process.exit(0);

// firebase deploy / firebase.cmd deploy / npx firebase deploy / npx -y firebase-tools deploy ...
const DEPLOY_RE = /(?:^|[\s;&|(])(?:npx\s+(?:-y\s+)?)?firebase(?:-tools)?(?:\.cmd)?\s+deploy\b/i;
if (!DEPLOY_RE.test(command)) process.exit(0);

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
