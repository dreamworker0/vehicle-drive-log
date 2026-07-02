# CLAUDE.md

차량 운행일지(`vehicle-drive-log`) — 사회복지기관·비영리단체용 무료 차량 운행일지 PWA. 전체 개요는 [README.md](README.md), 운영 매뉴얼은 [OPERATIONS.md](OPERATIONS.md), 컨벤션은 [CONTRIBUTING.md](CONTRIBUTING.md).

## 핵심 참조 (반드시 따를 것)

- **에이전트 행동 규칙**: [.agent/agents.md](.agent/agents.md) — 절대 금지 목록(§1), 자동 교정 루프(§2), 작업별 체크리스트(§4), 판단 가이드(§5)
- **세부 규칙**: [.agent/rules/](.agent/rules/) — coding-conventions, design-system, cloud-functions, firestore-rules 등 도메인별 규칙 파일
- **스킬 가이드**: [.agent/skills/](.agent/skills/) — 작업별 패턴 가이드 (아래 테이블 참고)
- **워크플로우**: [.agent/workflows/](.agent/workflows/) — `/deploy`, `/test`, `/build` 등 자동화 스크립트

## 스택 & 환경

- React 19 + Vite 7 + TypeScript / TailwindCSS v3 / Zustand
- Firebase (Auth + Firestore + Functions + Hosting + FCM) / Sentry / Gemini OCR
- **Node 22 LTS 필수**. Node 24는 Rollup 빌드 실패. `fnm use 22` 후 작업.
- Cloud Functions는 ESM, Node 22.

## 명령어

| 명령 | 용도 |
|---|---|
| `npm run dev` | 개발 서버 (localhost:5173) |
| `npm run build` | 프로덕션 빌드 (prebuild: SW 설정, postbuild: 번들 크기 체크) |
| `npm run type-check` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest 단위 |
| `npm run test:e2e` | Playwright |
| `npm run test:rules` | Firestore Rules (에뮬레이터) |
| `npm run health` | Cloud Functions 상태 점검 |
| `npm run audit` | 보안 감사 |
| `firebase deploy` | **로컬에서 직접 실행 금지** — 배포는 master 푸시 시 CI(Deploy 워크플로)가 수행한다. 로컬 배포를 병행하면 동일 함수 동시 업데이트 충돌이 발생. 긴급 시에만 CI 미실행을 확인하고 Node 22로 실행 |

## 디렉토리 컨벤션

- `src/components/` — 역할별 분리: `auth/`, `superAdmin/`, `admin/`, `employee/`, `common/`. 역할 경계 넘기지 않기.
- `src/lib/firestore/` — **도메인별 파일 분리**. 컴포넌트에서는 `index.ts`를 통해 import. → [firestore-model-pattern](.agent/skills/firestore-model-pattern/SKILL.md) 참고.
- `src/hooks/` — 비즈니스 로직을 컴포넌트에서 분리. → [add-hook](.agent/skills/add-hook/SKILL.md) 참고.
- `src/store/` — Zustand 글로벌 UI 상태. 도메인 데이터는 Zustand에 넣지 않는다.
- `functions/src/` — Cloud Functions. → [add-cloud-function](.agent/skills/add-cloud-function/SKILL.md) 참고. `index.ts`에서 export 필수.
- `scripts/` — 일회성/운영 스크립트 (`tsx`로 실행).

## 절대 규칙

1. **`organizationId` 필터 필수** — Firestore 쿼리는 멀티테넌트. 누락 시 다른 기관 데이터가 새거나 권한 거부가 난다. tenant-scoped 도메인 파일(`src/lib/firestore/`)은 커스텀 ESLint 규칙 `local/require-organization-filter`가 정적으로 강제한다(전역 도메인 제외).
2. **`firestore.indexes.json` 동기화** — 복합 쿼리 추가하면 인덱스도 추가.
3. **`functions/src/index.ts` 등록** — 새 함수는 여기서 export하지 않으면 배포되지 않는다.
4. **커밋 메시지는 한국어 + Conventional Commits** — `feat:`, `fix:`, `chore:`, `refactor:`. commitlint로 강제됨.
5. **민감 정보 금지** — `.env`/`.env.local`은 절대 커밋·노출 금지. API 키는 코드에 하드코딩하지 않는다.
6. **코드 수정 후 자동 교정 루프** — [agents.md §2](.agent/agents.md) 참고. lint → tsc → build → test 순서로 검증.

## 스킬 참조 테이블

`.agent/skills/`가 단일 원본이며, `scripts/sync-claude-agents.ts`가 이를 `.claude/skills/`(자동 발동 포인터)로 동기화하므로 Claude Code에서는 **아래 스킬이 자동 발동**된다(`npm run sync:agents`). 자동 발동되지 않더라도, 작업이 다음에 해당하면 해당 SKILL.md를 먼저 읽고 진행한다.

| 작업 | 가이드 |
|---|---|
| Firestore 함수 추가 | [firestore-model-pattern](.agent/skills/firestore-model-pattern/SKILL.md) |
| Cloud Function 추가 (스케줄 포함) | [add-cloud-function](.agent/skills/add-cloud-function/SKILL.md) |
| Firestore 필드 추가/마이그레이션 | [firestore-model-pattern](.agent/skills/firestore-model-pattern/SKILL.md), [data-migration-script](.agent/skills/data-migration-script/SKILL.md) |
| 커스텀 훅 추가 | [add-hook](.agent/skills/add-hook/SKILL.md) |
| 컴포넌트 추가 | [add-component](.agent/skills/add-component/SKILL.md) |
| 토글/스위치 등 공용 컨트롤 | [shared-ui-controls](.agent/skills/shared-ui-controls/SKILL.md) |
| Zod 스키마 추가 | [add-zod-validation](.agent/skills/add-zod-validation/SKILL.md) |
| PDF/Excel 내보내기 | [data-export-pattern](.agent/skills/data-export-pattern/SKILL.md) |
| 카카오 알림톡 | [add-alimtalk](.agent/skills/add-alimtalk/SKILL.md) |
| 이메일 알림 | [add-email-notification](.agent/skills/add-email-notification/SKILL.md) |
| 캘린더 연동 | [add-calendar-integration](.agent/skills/add-calendar-integration/SKILL.md) |
| 쿼리 성능 최적화 | [firestore-query-optimization](.agent/skills/firestore-query-optimization/SKILL.md) |
| Firebase 운영 비용 절감 | [firebase-cost-reduction](.agent/skills/firebase-cost-reduction/SKILL.md) |
| 분석 이벤트 트래킹 | [add-analytics-tracking](.agent/skills/add-analytics-tracking/SKILL.md) |
| PWA 기능 추가 | [add-pwa-feature](.agent/skills/add-pwa-feature/SKILL.md) |
| 다크모드 점검 | [dark-mode-audit](.agent/skills/dark-mode-audit/SKILL.md) |
| 테스트 작성 | [write-test](.agent/skills/write-test/SKILL.md) |
| 배포 문제 진단 | [troubleshoot-deployment](.agent/skills/troubleshoot-deployment/SKILL.md) |
| 배포 전 일괄 점검 | [pre-deploy-check](.agent/skills/pre-deploy-check/SKILL.md) |
| Sentry 노이즈 에러 필터 | [sentry-noise-filter](.agent/skills/sentry-noise-filter/SKILL.md) |
| FAQ 갱신 | [update-faq](.agent/skills/update-faq/SKILL.md) |
| 설정 UI 추가 | [settings-ui](.agent/skills/settings-ui/SKILL.md) |
| 차량 색상 표시 | [vehicle-color](.agent/skills/vehicle-color/SKILL.md) |
| 대시보드 UI | [dashboard-ui-pattern](.agent/skills/dashboard-ui-pattern/SKILL.md) |
| 코드 정리 (미사용 코드·패키지) | [code-cleanup](.agent/skills/code-cleanup/SKILL.md) |
| Gemini OCR 연동 | [gemini-ocr-integration](.agent/skills/gemini-ocr-integration/SKILL.md) |

위 테이블의 스킬은 모두 `.claude/skills/`로 동기화되어 Claude Code에서 자동 발동된다. `.agent/workflows/`도 `.claude/commands/`로 동기화되어 `/deploy`, `/test`, `/build` 등 **슬래시 커맨드**로 사용할 수 있다. 두 브리지 모두 `scripts/sync-claude-agents.ts`가 생성하므로 **원본은 항상 `.agent/`에서만 수정**하고 `npm run sync:agents`로 재생성한다 (CI가 `--check`로 강제).

## 테스트 정책

- 단위 테스트(Vitest)는 PR 머지 조건. lint-staged가 변경 파일 관련 테스트 자동 실행.
- Firestore Rules 변경 시 `npm run test:rules`로 에뮬레이터 검증.
- Cloud Functions 비즈니스 로직은 `functions/src/__tests__/`에 단위 테스트.

## 에러/로깅

- 프론트엔드 Sentry: [src/lib/sentry.ts](src/lib/sentry.ts) — `ignoreErrors` 리스트 + `beforeSend` 훅. 노이즈 에러는 여기에만 추가.
- Functions Sentry: [functions/src/sentry.ts](functions/src/sentry.ts) — `captureError(err, ctx)` 사용. Discord 웹훅 병행.
- 사용자 메시지 출력은 `react-hot-toast`. `alert()` 금지.

## 작업 스타일

- 응답은 한국어. 코드 주석도 한국어.
- 자잘한 정리·리팩토링을 작업에 끼워 넣지 않는다 (사용자가 명시한 변경만).
- 새 파일·문서 생성 전에 기존 파일 편집으로 끝나는지 먼저 확인.
- 배포 후 환경 변경(Phase 회고, CHANGELOG, .env.example 등)은 `chore:` 커밋으로 별도 분리.
