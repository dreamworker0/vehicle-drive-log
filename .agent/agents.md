# 🤖 에이전트 행동 헌법

> 이 문서는 AI 에이전트가 **모든 작업 전에 가장 먼저 참조**하는 최상위 규칙이다.
> 세부 규칙은 `rules/`, 패턴 가이드는 `skills/`, 자동화는 `workflows/`에 있다.
> **에이전트는 하위 문서를 선제적으로 읽지 않으며, 현재 작업 도메인에 해당하는 문서만 선택적으로 참조한다.**
> 두 에이전트(Antigravity ↔ Claude Code) 공용 구조와 `.agent/`→`.claude/` 동기화 규칙은 [multi-agent-coordination](rules/multi-agent-coordination.md) 참고.

---

## §1. 절대 금지 목록 (Don'ts)

아래 표의 항목을 위반하는 코드를 **생성하거나 제안하지 않는다.**

### 1.1 자동 감지 가능 (ESLint / TypeScript)

> **D1~D6**: `window.confirm/alert/prompt` 사용 금지, `any` 타입 금지, 미사용 변수/import 금지, 클래스 컴포넌트 금지.
> ESLint/TypeScript가 자동 감지하며, §2 자동 교정 루프에서 수정됨. 상세 목록은 [coding-conventions](rules/coding-conventions.md) 참고.

### 1.2 에이전트 판단 필요 (자동 감지 불가)

| # | 금지 항목 | 대안 | 근거 |
|---|----------|------|------|
| D7 | Tailwind 기본 색상 직접 사용 (`blue-500`, `green-600` 등) | 커스텀 토큰 (`primary-*`, `surface-*`, `accent-*`) | [design-system §1](rules/design-system.md) |
| D8 | 인라인 색상에 `dark:` 변형 누락 | 반드시 라이트/다크 페어링 | [design-system §1](rules/design-system.md) |
| D9 | 컴포넌트 내부에서 직접 Firestore 호출 | `lib/firestore/` 도메인 파일에 함수 작성 후 import | [coding-conventions §3.1](rules/coding-conventions.md) |
| D10 | `organizationId` 없는 Firestore 쿼리 | 모든 쿼리에 조직 격리 조건 포함 (tenant-scoped 파일은 `local/require-organization-filter` ESLint 규칙으로 정적 강제 — §1.1로 자동 감지됨) | [coding-conventions §3.3](rules/coding-conventions.md) |
| D11 | 프론트엔드 UI 가림만으로 권한 제어 | 백엔드(Rules/Functions)에서 반드시 재검증 | [role-based-access §2](rules/role-based-access.md) |
| D12 | 특정 UID/이메일 하드코딩 | 상수 또는 환경변수로 관리 (superAdmin 이메일 제외) | [firestore-rules §6](rules/firestore-rules.md) |
| D13 | `index.ts`에 비즈니스 로직 작성 (Cloud Functions) | 개별 모듈 파일로 분리, index.ts는 export만 | [cloud-functions §2](rules/cloud-functions.md) |
| D14 | 무한 루프 방지 없이 트리거가 같은 문서 수정 | `syncSource` 등 플래그로 제어 | [cloud-functions §3.3](rules/cloud-functions.md) |
| D15 | 불필요한 새 라이브러리 추가 | 기존 라이브러리로 해결 가능한지 먼저 확인 | [coding-conventions §8](rules/coding-conventions.md) |
| D16 | 터치 타겟 48px 미만 | 최소 48px 확보 | [pwa-mobile-first §2](rules/pwa-mobile-first.md) |
| D17 | v3식 `tailwind.config.js` 신설·v3 전용 문법 혼용 | TailwindCSS v4 (`@import "tailwindcss"`, `@theme`, `@custom-variant`; `@apply`·`@layer` 가능) | [coding-conventions §7](rules/coding-conventions.md) |
| D18 | 브라우저 서브 에이전트 자의적 실행 | 사용자 명시적 요청 시에만 | 사용자 전역 지침 |
| D19 | 사용자에게 질문/확인을 요청한 뒤 승인 없이 임의 단계 진행 | 반드시 사용자의 명확한 답변/승인을 기다린 후 다음 태스크 수행 | 사용자 전역 지침 |

### 1.3 충돌 해소 원칙

Don'ts 항목 간 충돌, 또는 금지 항목과 기능 요구가 충돌할 때의 우선순위:

```
🔴 보안 (D10, D11, D12)  →  데이터 유출/권한 탈취 위험
🟠 무결성 (D9, D13, D14) →  데이터 오염/시스템 장애 위험
🟡 품질 (D4~D8, D15~D17) →  유지보수/UX 품질 저하
🔵 편의 (D1~D3, D5, D18) →  개발 편의/코드 청결
```

- **상위 등급은 절대 양보하지 않는다** (보안 > 무결성 > 품질 > 편의)
- 같은 등급 내 충돌 시 → 사용자에게 확인
- 긴급 배포 시에도 🔴 보안 항목은 반드시 준수

---

## §2. 자동 교정 루프 (Auto-Correction Loop)

에이전트가 코드를 작성하거나 수정한 **직후**, 아래 검증 파이프라인을 실행한다.

### 2.1 검증 순서

> ⚠️ **이 머신의 셸 기본 Node는 v24이고, Node 24는 Rollup 빌드(Step 3)가 실패한다.**
> 검증 명령은 **반드시 Node 22**로 실행한다 — PowerShell: `fnm exec --using=22 npm.cmd run <script>`.
> Step 1(ESLint)은 편집 직후 PostToolUse 훅(`scripts/hooks/lint-changed.mjs`)이 변경 파일에
> 자동 실행하므로, 에이전트는 보통 Step 2~4에 집중한다(훅이 exit 2로 잔여 위반을 피드백).

```
Step 1: ESLint ──────── npm run lint          # 편집 시 훅이 변경 파일에 자동 실행
Step 2: TypeScript ──── fnm exec --using=22 npm.cmd run type-check
Step 3: Build ───────── fnm exec --using=22 npm.cmd run build   # Node 22 필수 (24는 Rollup 실패)
Step 4: Test ────────── fnm exec --using=22 npm.cmd test (변경 파일 관련 테스트만)
```

### 2.2 변경 범위별 검증 수준

| 변경 범위 | Step 1 (lint) | Step 2 (tsc) | Step 3 (build) | Step 4 (test) |
|----------|:---:|:---:|:---:|:---:|
| `.md`, `.json`, `.agent/` 변경 | — | — | — | — |
| `.css` 변경 | ✅ | — | ✅ | — |
| `.tsx/.ts` 단순 수정 (텍스트, 스타일) | ✅ | ✅ | — | — |
| `.tsx/.ts` 로직 변경 (Hook, 유틸, API) | ✅ | ✅ | ✅ | ✅ (관련 테스트) |
| `functions/src/` 변경 | ✅ | ✅ (functions) | ✅ (functions) | ✅ (관련 테스트) |
| 다수 파일 / 구조 변경 | ✅ | ✅ | ✅ | ✅ (전체) |

### 2.3 재시도 규칙

| 규칙 | 내용 |
|------|------|
| **최대 재시도** | 각 Step 실패 시 **2회까지** 자동 수정 후 재검증 |
| **포기 조건** | 2회 재시도 후에도 실패하면 사용자에게 보고하고 중단 |

### 2.4 실패 시 자동 수정 흐름

```
실패 발생
   │
   ├─ lint 실패 → ESLint 에러 메시지 분석 → 해당 코드 수정 → 재실행
   │
   ├─ tsc 실패 → 타입 에러 메시지 분석 → 타입 수정/추가 → 재실행
   │
   ├─ build 실패 → 빌드 에러 분석 → import/export 수정 → 재실행
   │
   └─ test 실패 → 테스트 실패 원인 분석
        ├─ 코드 버그 → 코드 수정 (테스트가 맞다고 가정)
        └─ 테스트 업데이트 필요
             ├─ import 경로, 모듈명 등 사소한 변경 → 자동 수정
             └─ 기존 assertion 변경 (기대값, 검증 로직) → ⚠️ 사용자 확인 필수
                  "기존 테스트의 assertion을 변경해야 합니다.
                   변경 사유: {원인 요약}. 진행할까요?"
```

### 2.5 예외 상황

- **문서만 수정** (`.md`, 주석 변경): 검증 생략
- **에이전트 설정만 수정** (`.agent/` 내부): 검증 생략
- **사용자가 "검증 생략"을 명시적으로 요청**: 생략 가능

---

## §3. 프리커밋 훅 (Pre-commit Hook)

Git 커밋 시 `Husky` + `lint-staged`가 스테이징 파일에 ESLint를 자동 실행한다 (2~3초).
상세 설정은 [pre-commit](rules/pre-commit.md) 참고, 설치/재설치는 `/pre-commit` 워크플로우 참고.

---

## §4. 작업별 체크리스트

### 새 기능 추가 시

- [ ] 기존 훅/컴포넌트와 역할 겹침 확인 → [coding-conventions §1](rules/coding-conventions.md)
- [ ] 적합한 스킬(SKILL.md) 먼저 읽기
- [ ] 파일 위치 결정 (역할별 → `components/{role}/`, 공용 → `common/`)
- [ ] 다크 모드 `dark:` 변형 페어링 → D8
- [ ] 모바일 뷰 우선 확인 → [pwa-mobile-first](rules/pwa-mobile-first.md)
- [ ] 오프라인 지원 필요 여부 확인 → [offline-first](rules/offline-first.md)
- [ ] Firestore 쿼리에 `organizationId` 포함 → D10
- [ ] 타입 정의 (types/ 디렉토리)
- [ ] 에러 핸들링 패턴 확인 → [error-handling](rules/error-handling.md)
- [ ] 인증 토큰 복원력 확인 → [token-auth-resilience](rules/token-auth-resilience.md)
- [ ] 자동 교정 루프 실행 → §2

### UI 수정 시

- [ ] 커스텀 색상 토큰 사용 → D7
- [ ] 공통 CSS 클래스 우선 사용 (`glass-card`, `btn-*`, `badge-*`)
- [ ] 다크 모드 확인 → D8, [dark-mode-audit 스킬](skills/dark-mode-audit/SKILL.md)
- [ ] 터치 타겟 최소 48px → D16
- [ ] 차량 표시 시 → [vehicle-color 스킬](skills/vehicle-color/SKILL.md)
- [ ] 자동 교정 루프 실행 → §2

### Cloud Functions 추가/수정 시

- [ ] [add-cloud-function 스킬](skills/add-cloud-function/SKILL.md) 읽기
- [ ] 리전: `asia-northeast3` (서울)
- [ ] 타임존: `Asia/Seoul`
- [ ] `index.ts`에 등록만 (로직 금지) → D13
- [ ] 동시성 중요 로직은 트랜잭션 필수 → [cloud-functions §3.4](rules/cloud-functions.md)
- [ ] 트리거 무한 루프 방지 → D14
- [ ] 자동 교정 루프 실행 → §2

### 배포 시

- [ ] CI/CD 파이프라인 규칙 확인 → [ci-cd](rules/ci-cd.md)
- [ ] 커밋 메시지 규칙 준수 → [commit-message](rules/commit-message.md)
- [ ] 번들 크기 예산 확인 → [bundle-size-budget](rules/bundle-size-budget.md)
- [ ] 이번 배포에 포함된 업데이트 소식, FAQ 변경사항 반영 (`src/lib/faqData.ts` 등)
- [ ] `구현계획서.md` 체크리스트 및 히스토리 최신 상태로 갱신
- [ ] Git 스테이징 → 커밋 → 푸시 (원격 백업)
- [ ] Node.js 22 확인: `fnm use 22 && node --version`
- [ ] 자동 교정 루프 전체 통과 → §2
- [ ] `/deploy` 워크플로우 실행 (빌드 + 배포 자동화)

---

## §5. 판단 가이드

에이전트가 애매한 상황에서 참고하는 의사결정 기준.

### 5.1 새 라이브러리를 추가해야 할까?

```
기존 라이브러리로 가능한가?
   ├─ 예 → 기존 것 사용 (D15)
   └─ 아니오 → 번들 크기 영향은?
        ├─ 작음 (< 10KB gzip) → 추가 가능
        └─ 큼 (> 10KB gzip) → 사용자에게 확인 요청
```

### 5.2 파일을 어디에 만들어야 할까?

```
어떤 역할이 사용하는가?
   ├─ 1개 역할만 → components/{role}/
   ├─ 2개 이상 역할 → components/common/
   └─ 데이터 접근 → lib/firestore/{domain}.ts
       비즈니스 로직 → hooks/use{Feature}.ts
       외부 API → lib/{service}.ts
```

### 5.3 테스트를 작성해야 할까?

```
변경 유형은?
   ├─ 새 훅/유틸 함수 → 반드시 단위 테스트 작성
   ├─ 기존 로직 수정 → 기존 테스트 업데이트 + 엣지 케이스 추가
   ├─ UI 컴포넌트 추가 → 선택적 (복잡한 상호작용이 있으면 작성)
   └─ 설정/문서 변경 → 테스트 불필요
```

### 5.4 에이전트가 스스로 결정 vs 사용자에게 물어야 할 때

| 스스로 결정 가능 | 사용자에게 확인 필요 |
|-----------------|---------------------|
| 파일 위치 (§5.2 기준) | 새 라이브러리 추가 (큰 사이즈) |
| 변수/함수 이름 (네이밍 컨벤션 기준) | DB 스키마 변경 (필드 추가/삭제) |
| 다크 모드 색상 페어링 | 보안 규칙 변경 |
| 에러 메시지 문구 | 기존 API 인터페이스 변경 |
| 테스트 코드 작성 | 사용자 권한 체계 변경 |
| 새 테스트 추가 | 기존 테스트 assertion 변경 (§2.4) |

### 5.5 구현 전 기획·스코프 리뷰

비자명한 새 기능·큰 변경은 **구현 전에** 전제 도전 → 기존 코드 레버리지 → 구현 대안 2~3개 제시 → 스코프 모드 합의 → 가드레일 점검을 거친다. plan mode가 강제하지 않는 이 델타는 [planning-scope-review](rules/planning-scope-review.md)에 정의. **EXPANSION(확장)은 기본값이 아니며 사용자가 명시 요청할 때만 가동**한다(규모 적합 축소 편향).

### 5.6 판단 근거 기록

에이전트가 **예외적인 판단**을 내린 경우, 작업 완료 보고 시 근거를 1줄로 남긴다.

| 상황 | 기록 여부 | 예시 |
|------|:---------:|------|
| §1.3 충돌 해소 적용 | ✅ 필수 | `[충돌 해소: D10 > D15, 보안 우선]` |
| §5.4 경계선 판단 | ✅ 필수 | `[판단: 번들 8KB이므로 자동 추가]` |
| §5.4 "스스로 결정 가능" 범위 내 | ❌ 불필요 | — |
| 가이드에 명시된 대로 행동 | ❌ 불필요 | — |
