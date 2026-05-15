# CLAUDE.md

차량 운행일지(`vehicle-drive-log`) — 사회복지기관·비영리단체용 무료 차량 운행일지 PWA. 작업할 때 알아야 할 핵심만 정리한다. 전체 개요는 [README.md](README.md), 운영 매뉴얼은 [OPERATIONS.md](OPERATIONS.md), 컨벤션은 [CONTRIBUTING.md](CONTRIBUTING.md).

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
| `firebase deploy` | 전체 배포 (반드시 Node 22 확인) |

## 디렉토리 컨벤션

- `src/components/` — 역할별 분리: `auth/`, `superAdmin/`, `admin/`, `employee/`, `common/`. 역할 경계 넘기지 않기.
- `src/lib/firestore/` — **도메인별 파일 분리** (driveLogs.ts, reservations.ts, users.ts 등). 컴포넌트에서는 항상 `../../lib/firestore`의 `index.ts`를 통해 import. 새 함수 추가 시 [.agent/skills/add-firestore-fn/SKILL.md](.agent/skills/add-firestore-fn/SKILL.md) 참고.
- `src/hooks/` — 비즈니스 로직을 컴포넌트에서 분리. `utils/` 하위는 훅에서 추출된 순수 함수.
- `src/store/` — Zustand 글로벌 UI 상태 (테마, Toast, 모달 등). 도메인 데이터는 Zustand에 넣지 않는다.
- `functions/src/` — Cloud Functions. 함수 추가는 [.agent/skills/add-firestore-fn/SKILL.md](.agent/skills/add-firestore-fn/SKILL.md)·`add-cloud-function`·`add-scheduler-job` 참고. `index.ts`에서 export 필수.
- `scripts/` — 일회성/운영 스크립트 (`tsx`로 실행). 마이그레이션·점검은 여기.

## 절대 규칙

1. **`organizationId` 필터 필수** — Firestore 쿼리는 멀티테넌트. 누락 시 다른 기관 데이터가 새거나 권한 거부가 난다. 예외는 시스템 관리자 전용 컬렉션뿐.
2. **`firestore.indexes.json` 동기화** — 복합 쿼리 추가하면 인덱스도 추가. 누락 시 운영에서 쿼리 실패.
3. **`functions/src/index.ts` 등록** — 새 함수는 여기서 export하지 않으면 배포되지 않는다.
4. **커밋 메시지는 한국어 + Conventional Commits** — `feat:`, `fix:`, `chore:`, `refactor:`. commitlint로 강제됨. 본문은 한국어.
5. **민감 정보 금지** — `.env`/`.env.local`은 절대 커밋·노출 금지. API 키는 코드에 하드코딩하지 않는다.

## 자주 하는 작업과 참고할 스킬

`.agent/skills/`의 가이드는 **자동 발동되지 않는 참고 문서**다. 작업이 다음에 해당하면 해당 SKILL.md를 먼저 읽고 진행한다.

| 작업 | 가이드 |
|---|---|
| Firestore 함수 추가 | [.agent/skills/add-firestore-fn/SKILL.md](.agent/skills/add-firestore-fn/SKILL.md) |
| Cloud Function 추가 | [.agent/skills/add-cloud-function/SKILL.md](.agent/skills/add-cloud-function/SKILL.md) |
| 스케줄 함수 추가 | [.agent/skills/add-scheduler-job/SKILL.md](.agent/skills/add-scheduler-job/SKILL.md) |
| Firestore 필드 추가/마이그레이션 | [.agent/skills/add-firestore-field/SKILL.md](.agent/skills/add-firestore-field/SKILL.md), [.agent/skills/data-migration-script/SKILL.md](.agent/skills/data-migration-script/SKILL.md) |
| 커스텀 훅 추가 | [.agent/skills/add-hook/SKILL.md](.agent/skills/add-hook/SKILL.md) |
| 컴포넌트 추가 | [.agent/skills/add-component/SKILL.md](.agent/skills/add-component/SKILL.md) |
| Zod 스키마 추가 | [.agent/skills/add-zod-validation/SKILL.md](.agent/skills/add-zod-validation/SKILL.md) |
| PDF/Excel 내보내기 | [.agent/skills/add-pdf-export/SKILL.md](.agent/skills/add-pdf-export/SKILL.md), [.agent/skills/add-excel-export/SKILL.md](.agent/skills/add-excel-export/SKILL.md) |
| 카카오 알림톡 | [.agent/skills/add-alimtalk/SKILL.md](.agent/skills/add-alimtalk/SKILL.md) |
| 이메일 알림 | [.agent/skills/add-email-notification/SKILL.md](.agent/skills/add-email-notification/SKILL.md) |
| 캘린더 연동 | [.agent/skills/add-calendar-integration/SKILL.md](.agent/skills/add-calendar-integration/SKILL.md) |
| 쿼리 성능 최적화 | [.agent/skills/firestore-query-optimization/SKILL.md](.agent/skills/firestore-query-optimization/SKILL.md) |
| 분석 이벤트 트래킹 | [.agent/skills/add-analytics-tracking/SKILL.md](.agent/skills/add-analytics-tracking/SKILL.md) |
| PWA 기능 추가 | [.agent/skills/add-pwa-feature/SKILL.md](.agent/skills/add-pwa-feature/SKILL.md) |
| 다크모드 점검 | [.agent/skills/dark-mode-audit/SKILL.md](.agent/skills/dark-mode-audit/SKILL.md) |
| 한국어 문구 다듬기 | [.agent/skills/humanize-korean/SKILL.md](.agent/skills/humanize-korean/SKILL.md) |
| 테스트 작성 | [.agent/skills/write-test/SKILL.md](.agent/skills/write-test/SKILL.md) |
| 배포 문제 진단 | [.agent/skills/troubleshoot-deployment/SKILL.md](.agent/skills/troubleshoot-deployment/SKILL.md) |
| FAQ 갱신 | [.agent/skills/update-faq/SKILL.md](.agent/skills/update-faq/SKILL.md) |

자동 발동되는 `.claude/skills/`의 스킬:
- **`pre-deploy-check`** — 배포 전 점검 루틴
- **`sentry-noise-filter`** — Sentry 노이즈 에러 필터 추가

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
