# 프로젝트 안정화 1단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Functions의 현재 moderate 취약점 3건을 제거하고, 원본 운영 문서의 배포 경로와 테스트 규모 표기가 다시 낡지 않도록 기계 검증한다.

**Architecture:** 의존성 문제는 잠금 파일의 최소 갱신부터 시작해 메이저 이관을 마지막 수단으로 둔다. 문서 정합성은 `scripts/check-harness.ts`에 순수 파서와 저장소 검사 항목을 추가해 CI가 회귀를 차단하고, README의 실행 시점 테스트 수와 안정적으로 계산 가능한 파일 수를 분리한다.

**Tech Stack:** Node.js 22, npm, TypeScript, Vitest, Firebase Functions, GitHub Actions 문서

**Spec:** `docs/superpowers/specs/2026-09-03-project-hardening-design.md`

## Global Constraints

- 스코프 모드는 `SELECTIVE`이며 새 사용자 기능, UI 재설계, Firestore 스키마·권한 변경은 하지 않는다.
- 모든 npm·TypeScript 검증은 Node.js 22에서 실행한다.
- 로컬 `firebase deploy`와 프로덕션 배포는 수행하지 않는다.
- `firebase-admin 14`와 `firebase-functions 7` 메이저 이관은 잠금 파일·패치 갱신으로 취약점이 해소되지 않을 때만 별도 커밋으로 수행한다.
- 테스트 케이스 수는 실행 결과를 근거로 날짜를 붙이고, CI는 실행 없이 안정적으로 계산 가능한 파일·suite 수만 검증한다.
- 문서 전용 커밋과 코드·설정 커밋을 분리한다.

---

### Task 1: Functions 의존성 취약점 최소 갱신

**Files:**
- Modify: `functions/package-lock.json`
- Modify only if required: `functions/package.json:20-44`
- Verify: `scripts/security-audit.ts`

**Interfaces:**
- Consumes: `functions/package.json`의 현재 직접 의존성 범위와 `npm audit --json` 리포트
- Produces: high·critical·moderate가 모두 0인 Functions 의존성 트리와 재현 가능한 잠금 파일

- [ ] **Step 1: 현재 취약점과 유입 경로를 RED 기준선으로 저장한다**

Run:

```powershell
fnm exec --using=22 npm.cmd --prefix functions audit --json
fnm exec --using=22 npm.cmd --prefix functions ls qs body-parser express
```

Expected: 첫 명령은 exit 1이고 `qs`, `body-parser`, `express`의 moderate 3건을 보고한다. 두 번째 명령은 `firebase-functions`와 `googleapis-common`을 통한 `qs@6.15.2` 경로를 보여 준다.

- [ ] **Step 2: 현재 선언 범위 안에서 잠금 파일만 최소 갱신한다**

Run:

```powershell
fnm exec --using=22 npm.cmd --prefix functions update --package-lock-only
fnm exec --using=22 npm.cmd --prefix functions ci
```

Expected: `functions/package-lock.json`만 바뀌거나, 최신 잠금 상태라면 변경이 없다. `npm ci`가 peer dependency 오류 없이 완료된다.

- [ ] **Step 3: 취약점 제거 여부를 확인한다**

Run:

```powershell
fnm exec --using=22 npm.cmd --prefix functions audit --json
fnm exec --using=22 npm.cmd --prefix functions ls qs body-parser express
```

Expected: audit metadata의 moderate/high/critical이 모두 0이다. 여전히 moderate가 있으면 Step 4로 진행한다.

- [ ] **Step 4: 잠금 파일 갱신으로 해결되지 않을 때만 호환 가능한 직접 의존성을 갱신한다**

먼저 변경 예상치를 확인한다.

```powershell
fnm exec --using=22 npm.cmd --prefix functions outdated
fnm exec --using=22 npm.cmd --prefix functions audit fix --dry-run --json
```

`audit fix --dry-run`이 현재 메이저 범위의 `firebase-functions` 또는 `googleapis` 갱신을 제안하면 해당 패키지만 설치한다.

```powershell
fnm exec --using=22 npm.cmd --prefix functions install firebase-functions@^6 googleapis@^176
```

Expected: `functions/package.json`의 메이저 범위는 유지되고 audit의 moderate/high/critical이 0이 된다. `--force`는 사용하지 않는다. 메이저 7만 해법이면 이 Task를 중단하고 유지보수 백로그의 런타임 이관을 독립 계획으로 분리한다.

- [ ] **Step 5: Functions 검증을 실행한다**

Run:

```powershell
fnm exec --using=22 npm.cmd run type-check:functions
fnm exec --using=22 npm.cmd run test:functions:coverage
fnm exec --using=22 npm.cmd run test:functions:emulator
fnm exec --using=22 npm.cmd run audit
```

Expected: 타입 검사, 76개 비에뮬레이터 suite, 에뮬레이터 테스트, 보안 감사 모두 통과하고 보안 감사에 moderate가 표시되지 않는다.

- [ ] **Step 6: 의존성 변경만 커밋한다**

```powershell
git add functions/package.json functions/package-lock.json
git commit -m "fix: Functions 의존성 취약점을 해소한다"
```

---

### Task 2: 운영 문서의 직접 배포 명령 회귀 차단

**Files:**
- Modify: `scripts/__tests__/check-harness.test.ts`
- Modify: `scripts/check-harness.ts`
- Modify: `OPERATIONS.md:73-99,206-220,338-367`
- Modify: `ROLLBACK.md:7-99`

**Interfaces:**
- Consumes: 검사 대상 Markdown 문자열
- Produces: `findForbiddenDeployCommands(markdown: string): number[]` — 주석이 아닌 줄에서 `firebase deploy` 또는 `firebase-tools deploy`를 찾은 1-based 줄 번호 배열
- Produces: 하네스 17번 검사 — 원본 운영 문서 두 파일에 직접 배포 명령이 있으면 error

- [ ] **Step 1: 직접 배포 명령 탐지의 실패 테스트를 작성한다**

`scripts/__tests__/check-harness.test.ts`에 다음 테스트를 추가한다.

```ts
import { findForbiddenDeployCommands } from '../check-harness';

describe('findForbiddenDeployCommands', () => {
    it('Firebase CLI 직접 배포 명령의 줄 번호를 찾는다', () => {
        const markdown = [
            '# 운영',
            'firebase deploy --only functions',
            'npx firebase-tools deploy --only hosting',
        ].join('\n');

        expect(findForbiddenDeployCommands(markdown)).toEqual([2, 3]);
    });

    it('CI 배포 설명과 셀프호스터 링크는 차단하지 않는다', () => {
        const markdown = [
            'master 푸시 후 CI Deploy 워크플로를 확인한다.',
            '[셀프호스팅](docs/SELF_HOSTING.md)을 참고한다.',
        ].join('\n');

        expect(findForbiddenDeployCommands(markdown)).toEqual([]);
    });
});
```

- [ ] **Step 2: 테스트가 올바른 이유로 실패하는지 확인한다**

Run:

```powershell
fnm exec --using=22 npx.cmd vitest run scripts/__tests__/check-harness.test.ts
```

Expected: `findForbiddenDeployCommands`가 export되지 않아 FAIL한다.

- [ ] **Step 3: 최소 파서와 하네스 검사를 구현한다**

`scripts/check-harness.ts`의 순수 헬퍼 영역에 추가한다.

```ts
export function findForbiddenDeployCommands(markdown: string): number[] {
    return markdown
        .split(/\r?\n/)
        .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
        .filter(({ line }) => !line.startsWith('#'))
        .filter(({ line }) => /\b(?:npx\s+firebase-tools\s+|firebase\s+)deploy\b/.test(line))
        .map(({ lineNumber }) => lineNumber);
}
```

`runChecks()`에 17번 검사를 추가한다.

```ts
checked++;
for (const rel of ['OPERATIONS.md', 'ROLLBACK.md']) {
    for (const line of findForbiddenDeployCommands(read(rel))) {
        err(rel, `로컬 Firebase 직접 배포 명령이 남아 있음(${line}행) — CI Deploy 워크플로로 교체`);
    }
}
```

- [ ] **Step 4: 단위 테스트는 통과하고 하네스 본체는 기존 문서 때문에 실패하는지 확인한다**

Run:

```powershell
fnm exec --using=22 npx.cmd vitest run scripts/__tests__/check-harness.test.ts
fnm exec --using=22 npm.cmd run verify:harness
```

Expected: 단위 테스트 PASS, 하네스는 `OPERATIONS.md`와 `ROLLBACK.md`의 직접 배포 명령을 보고하며 FAIL한다.

- [ ] **Step 5: 운영 문서를 CI 단일 경로로 교체한다**

`OPERATIONS.md`는 다음 계약으로 수정한다.

```markdown
- 환경변수·Rules·Functions 변경은 브랜치 커밋과 PR을 거쳐 master에 반영한다.
- CI가 성공하면 Deploy 워크플로가 자동 배포한다.
- 긴급 수동 실행은 GitHub Actions → Deploy → Run workflow를 사용하고 실행 결과를 확인한다.
- 셀프호스터만 `docs/SELF_HOSTING.md`의 Firebase CLI 절차를 사용한다.
```

`ROLLBACK.md`는 다음 계약으로 수정한다.

```markdown
- Hosting은 Firebase Console의 릴리스 롤백을 가장 빠른 복구 경로로 유지한다.
- 코드·Functions·Rules 롤백은 이전 정상 커밋을 되돌리는 새 커밋/PR을 만들어 CI와 Deploy를 통과시킨다.
- 특정 함수·Rules만 로컬 CLI로 배포하는 절차는 제거한다.
- 즉시 복구가 필요하면 GitHub Actions의 Deploy workflow_dispatch를 사용한다.
```

- [ ] **Step 6: 문서 회귀 검사를 통과시킨다**

Run:

```powershell
fnm exec --using=22 npx.cmd vitest run scripts/__tests__/check-harness.test.ts
fnm exec --using=22 npm.cmd run verify:harness
rg -n "firebase deploy|firebase-tools deploy" OPERATIONS.md ROLLBACK.md
```

Expected: 테스트와 하네스 PASS, 마지막 검색은 결과 0건이다.

- [ ] **Step 7: 코드·문서 변경을 커밋한다**

```powershell
git add scripts/check-harness.ts scripts/__tests__/check-harness.test.ts OPERATIONS.md ROLLBACK.md
git commit -m "fix: 운영 배포 경로를 CI로 통일한다"
```

---

### Task 3: README 테스트 규모 드리프트 검사

**Files:**
- Modify: `scripts/__tests__/check-harness.test.ts`
- Modify: `scripts/check-harness.ts`
- Modify: `README.md:304-314`

**Interfaces:**
- Consumes: README 테스트 표 문자열과 저장소의 테스트 파일 경로 목록
- Produces: `extractDocumentedTestInventory(markdown: string): TestInventory | null`
- Produces: `countTestInventory(paths: string[]): TestInventory`
- Produces type:

```ts
export interface TestInventory {
    frontendFiles: number;
    functionSuites: number;
    rulesFiles: number;
    e2eSpecs: number;
}
```

- [ ] **Step 1: README 파서와 파일 분류의 실패 테스트를 작성한다**

`scripts/__tests__/check-harness.test.ts`에 다음 계약을 추가한다.

```ts
import {
    countTestInventory,
    extractDocumentedTestInventory,
} from '../check-harness';

it('README 테스트 표에서 파일·suite 수를 읽는다', () => {
    const markdown = [
        '| 단위 테스트 (프론트 + 스크립트) | 159파일 / 1,852개 테스트 | Vitest |',
        '| Functions 단위 테스트 | 76개 suite / 1,005개 테스트 | Jest |',
        '| Rules 테스트 | 2파일 / 37개 테스트 | Emulator |',
        '| E2E 테스트 | 26개 spec 파일 | Playwright |',
    ].join('\n');

    expect(extractDocumentedTestInventory(markdown)).toEqual({
        frontendFiles: 159,
        functionSuites: 76,
        rulesFiles: 2,
        e2eSpecs: 26,
    });
});

it('실행 대상별 테스트 파일을 같은 규칙으로 분류한다', () => {
    expect(countTestInventory([
        'src/__tests__/a.test.ts',
        'scripts/__tests__/b.test.ts',
        'scripts/hooks/__tests__/guard.test.mjs',
        'eslint-rules/local-rule.test.js',
        'functions/src/__tests__/c.test.ts',
        'functions/src/__tests__/d.emulator.test.ts',
        'tests/firestore-rules.test.ts',
        'tests/storage-rules.test.ts',
        'e2e/login.spec.ts',
    ])).toEqual({
        frontendFiles: 4,
        functionSuites: 1,
        rulesFiles: 2,
        e2eSpecs: 1,
    });
});
```

- [ ] **Step 2: 테스트가 미구현 export 때문에 실패하는지 확인한다**

Run:

```powershell
fnm exec --using=22 npx.cmd vitest run scripts/__tests__/check-harness.test.ts
```

Expected: 두 함수와 타입이 없어 FAIL한다.

- [ ] **Step 3: 순수 파서와 분류기를 구현한다**

`scripts/check-harness.ts`에 `TestInventory`, `extractDocumentedTestInventory`, `countTestInventory`를 추가한다. 파서는 네 행을 모두 찾지 못하면 `null`을 반환한다. 분류 규칙은 다음과 같다.

```ts
export function countTestInventory(paths: string[]): TestInventory {
    const normalized = paths.map((path) => path.replace(/\\/g, '/'));
    return {
        frontendFiles: normalized.filter((path) =>
            /^(src|scripts|eslint-rules)\/.+\.test\.(?:[cm]?js|tsx?)$/.test(path),
        ).length,
        functionSuites: normalized.filter((path) =>
            /^functions\/src\/__tests__\/.+\.test\.ts$/.test(path) &&
            !path.endsWith('.emulator.test.ts'),
        ).length,
        rulesFiles: normalized.filter((path) => /^tests\/.+-rules\.test\.ts$/.test(path)).length,
        e2eSpecs: normalized.filter((path) => /^e2e\/.+\.spec\.ts$/.test(path)).length,
    };
}
```

- [ ] **Step 4: 하네스에 저장소 실제 파일과 README 비교를 추가한다**

`runChecks()`의 18번 검사에서 `git ls-files` 결과를 `countTestInventory()`에 전달한다. README 파싱 실패는 error, 네 필드 중 하나라도 다르면 실제값과 문서값을 포함한 error를 만든다. `.worktrees`, `node_modules`, 생성물은 `git ls-files`에 포함되지 않으므로 별도 순회하지 않는다.

- [ ] **Step 5: 단위 테스트는 통과하고 README의 낡은 값 때문에 하네스가 실패하는지 확인한다**

Run:

```powershell
fnm exec --using=22 npx.cmd vitest run scripts/__tests__/check-harness.test.ts
fnm exec --using=22 npm.cmd run verify:harness
```

Expected: 단위 테스트 PASS, 하네스는 README 테스트 규모 불일치로 FAIL한다.

- [ ] **Step 6: README 테스트 표를 실제값과 측정일 기준으로 갱신한다**

Run:

```powershell
git ls-files "src/**/*" "scripts/**/*" "eslint-rules/**/*" "functions/src/__tests__/*" "tests/*-rules.test.ts" "e2e/*.spec.ts"
```

README에는 파일·suite 수를 현재 목록에 맞추고, 테스트 케이스 수는 다음처럼 측정일을 명시한다.

```markdown
> 테스트 케이스 수는 2026-09-03 Node 22 실행 결과다. 파일·suite 수는 `npm run verify:harness`가 저장소와 대조한다.
```

2026-09-03 실측 기준은 프론트 1,852개, Functions 1,005개, Rules 37개다. E2E 케이스 수는 이번 단계에서 실행하지 않았으므로 적지 않는다.

- [ ] **Step 7: 문서 수치 회귀 검사를 통과시킨다**

Run:

```powershell
fnm exec --using=22 npx.cmd vitest run scripts/__tests__/check-harness.test.ts
fnm exec --using=22 npm.cmd run verify:harness
```

Expected: 두 명령 모두 PASS하고 하네스 검사 영역 수가 18개로 증가한다.

- [ ] **Step 8: 코드·문서 변경을 커밋한다**

```powershell
git add scripts/check-harness.ts scripts/__tests__/check-harness.test.ts README.md
git commit -m "test: 테스트 문서 수치 드리프트를 차단한다"
```

---

### Task 4: 1단계 통합 검증과 구현이력 기록

**Files:**
- Modify: `docs/차량운행일지_구현계획서.md`
- Modify: `docs/구현이력.md` 또는 현재 Phase가 사용하는 분할 이력 파일

**Interfaces:**
- Consumes: Task 1~3의 커밋과 검증 결과
- Produces: 변경 이유·검증 수치·보류 항목이 기록된 새 Phase

- [ ] **Step 1: 전체 정적·단위 검증을 실행한다**

Run:

```powershell
fnm exec --using=22 npm.cmd run verify:harness
fnm exec --using=22 npm.cmd run verify:fast
fnm exec --using=22 npm.cmd run test:coverage
fnm exec --using=22 npm.cmd run test:functions:coverage
fnm exec --using=22 npm.cmd run build
fnm exec --using=22 npx.cmd firebase-tools emulators:exec --only firestore,storage "fnm exec --using=22 npx.cmd vitest run tests/firestore-rules.test.ts tests/storage-rules.test.ts"
fnm exec --using=22 npm.cmd run audit
```

Expected: 모든 명령 exit 0, 프론트·Functions 커버리지 하한 통과, 번들 예산 통과, Rules 37개 통과, audit moderate/high/critical 0건이다.

- [ ] **Step 2: 문서와 실제 상태의 잔여 충돌을 검색한다**

Run:

```powershell
rg -n "firebase deploy|firebase-tools deploy" OPERATIONS.md ROLLBACK.md
git status --short
git diff --check
```

Expected: 직접 배포 검색 결과 0건이고, 예상한 구현이력 문서 외 미확인 변경이 없다.

- [ ] **Step 3: 구현계획서와 이력에 새 Phase를 기록한다**

다음 내용을 기록한다.

```markdown
- Functions moderate 취약점 3건의 원인과 최종 해소 버전
- 원본 운영·롤백 문서를 CI 단일 배포 경로로 통일한 이유
- README 테스트 파일 수 드리프트를 하네스가 차단하는 방식
- 실제 실행한 테스트·커버리지·Rules·번들 결과
- 메이저 런타임 이관이 보류됐다면 그 사유와 별도 후속 트랙
```

- [ ] **Step 4: 이력 문서만 별도 커밋한다**

```powershell
git add docs/차량운행일지_구현계획서.md docs/구현이력.md docs/구현이력/
git commit -m "docs: 프로젝트 안정화 1단계 이력을 기록한다"
```

- [ ] **Step 5: 최종 상태를 확인한다**

Run:

```powershell
git status --short
git log -5 --oneline
```

Expected: 작업 트리가 깨끗하고 Task 1~4 커밋이 순서대로 존재한다. 푸시·PR·배포는 수행하지 않는다.
