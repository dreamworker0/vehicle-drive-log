# 에이전트 지침 (공용 진입점)

이 파일은 Codex 등 `AGENTS.md`를 자동으로 읽는 모든 AI 에이전트의 진입점이다.
Claude Code는 [CLAUDE.md](CLAUDE.md), Antigravity는 [.agent/agents.md](.agent/agents.md)를 직접 읽지만,
**규칙의 단일 원본은 항상 `.agent/`다.** 이 파일에는 규칙을 복제하지 않고 포인터와 최소 요약만 둔다.

## 필수 선행 참조 (작업 전 반드시 읽기)

1. **[.agent/agents.md](.agent/agents.md)** — 행동 헌법: 절대 금지 목록(§1), 자동 교정 루프(§2), 작업별 체크리스트(§4), 판단 가이드(§5)
2. 현재 작업 도메인에 해당하는 **[.agent/rules/](.agent/rules/)** 규칙과 **[.agent/skills/](.agent/skills/)** 스킬 — 전체를 선제 로딩하지 말고, 작업과 관련된 문서만 선택적으로 읽는다 (스킬 대응표는 [CLAUDE.md](CLAUDE.md)의 테이블 참고)
3. 프로젝트 개요·명령어 표 — [CLAUDE.md](CLAUDE.md) (Claude 전용 아님, 스택·명령·디렉토리 컨벤션의 공용 요약)

## 안전 규칙 요약 (상세·전체 목록은 .agent/agents.md §1)

플랫폼과 무관하게 절대 어겨서는 안 되는 항목:

- **멀티테넌트 격리**: Firestore 쿼리에 `organizationId` 필터 필수 (D10). 권한 제어는 백엔드(Rules/Functions)에서 재검증 (D11).
- **배포 단일 경로**: 로컬 `firebase deploy` 금지(간접 실행 포함 — `npm run deploy`, `npx firebase-tools deploy` 등). 배포는 master 푸시 → CI Deploy 워크플로만.
- **검증은 Node 22**: Node 24는 Rollup 빌드가 실패한다. `fnm exec --using=22 npm.cmd run <script>`. 코드 수정 후 자동 교정 루프(lint → tsc → build → test) 실행.
- **민감 정보 금지**: `.env`/`.env.local` 커밋·노출 금지, API 키 하드코딩 금지.
- **브리지 자동 생성**: `.claude/skills/`·`.claude/commands/`는 자동 생성물 — 수정은 `.agent/` 원본에서만 하고 `npm run sync:agents`로 재생성.
- **커밋 메시지**: 한국어 + Conventional Commits (`feat:`, `fix:`, `chore:`, ...). commitlint가 강제.

통합 검증 진입점: `npm run verify:harness`(하네스 정합성) / `npm run verify:fast`(lint·타입) / `npm run verify:full`(전체 게이트).

## 응답 언어

- 사용자에게 보내는 모든 답변은 한국어로 작성한다. 코드 주석도 한국어.
