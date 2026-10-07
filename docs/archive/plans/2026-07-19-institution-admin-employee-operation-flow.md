# Institution Admin and Employee Operation Flow PNG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 기관관리자·기관직원 두 관점의 흐름 시안을 정확한 한글을 유지한 3200×1800 PNG로 제작한다.

**Architecture:** 승인된 브라우저 시안 HTML을 영구 문서 소스로 보존하고 Playwright가 해당 다이어그램 요소만 캡처한다. Sharp가 결과를 3200×1800 PNG로 변환하고 형식과 크기를 검증한다.

**Tech Stack:** HTML/CSS, TypeScript 5.9, TSX, Playwright 1.59, Sharp 0.34, Vitest 4

## Global Constraints

- 최종 파일은 `docs/images/vehicle-drive-log-organization-journey.png`다.
- 출력 크기는 정확히 3200×1800px PNG다.
- 기관관리자는 파랑, 기관직원은 청록, 서비스 지원은 보라, 역할 간 인계는 주황을 사용한다.
- 표나 동일 크기 격자를 사용하지 않고 두 개의 독립적인 가로 흐름을 사용한다.
- 시스템 관리자는 주인공이 아니라 상단 서비스 지원 영역으로만 표현한다.
- 모든 한글은 브라우저 글꼴로 렌더링해 문자 왜곡을 방지한다.
- 승인 원본은 `.superpowers/brainstorm/20260719-122407-24732/content/two-perspective-flow-v3.html`이다.

---

## File Structure

- Create: `docs/diagrams/vehicle-drive-log-organization-journey.html` — 승인된 두 관점 흐름도의 재현 가능한 HTML/CSS 원본이다.
- Create: `scripts/render-organization-journey.ts` — HTML을 읽어 다이어그램만 캡처하고 3200×1800 PNG를 검증한다.
- Create: `scripts/__tests__/renderOrganizationJourney.test.ts` — 역할, 단계, 인계와 도구 문구의 누락을 방지한다.
- Modify: `package.json` — `diagram:organization` 생성 명령을 추가한다.
- Create: `docs/images/vehicle-drive-log-organization-journey.png` — 최종 결과물이다.

### Task 1: 승인 시안을 영구 HTML 원본으로 보존

**Files:**
- Create: `scripts/__tests__/renderOrganizationJourney.test.ts`
- Create: `docs/diagrams/vehicle-drive-log-organization-journey.html`

**Interfaces:**
- Consumes: `.superpowers/brainstorm/20260719-122407-24732/content/two-perspective-flow-v3.html`
- Produces: `docs/diagrams/vehicle-drive-log-organization-journey.html`

- [ ] **Step 1: 영구 HTML 원본의 콘텐츠 계약 테스트 작성**

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourcePath = path.resolve(
  process.cwd(),
  'docs',
  'diagrams',
  'vehicle-drive-log-organization-journey.html',
);

describe('vehicle-drive-log organization journey source', () => {
  it('두 역할의 전체 업무 흐름을 포함한다', () => {
    const html = readFileSync(sourcePath, 'utf8');
    [
      '기관관리자 관점',
      '서비스 도입 신청',
      '승인·온보딩',
      '차량·운영 설정',
      '직원 초대·배포',
      '운영 현황 관리',
      '보고·차량 개선',
      '기관직원 관점',
      '초대받고 가입',
      '앱 설치·연동',
      '차량 예약',
      '운행·일지 작성',
      '내 기록 확인',
    ].forEach((label) => expect(html).toContain(label));
  });

  it('역할 간 인계와 핵심 도구를 포함한다', () => {
    const html = readFileSync(sourcePath, 'utf8');
    [
      '직원 초대·사용 권한',
      '운행 기록·현황',
      'Google Calendar',
      'TMAP',
      'Slack',
      'PDF·Excel',
    ].forEach((label) => expect(html).toContain(label));
  });

  it('표 요소 없이 두 개의 흐름 영역을 사용한다', () => {
    const html = readFileSync(sourcePath, 'utf8');
    expect(html).not.toContain('<table');
    expect(html.match(/class="journey (admin|emp)"/g)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 테스트를 실행해 영구 HTML 원본 부재로 실패하는지 확인**

Run: `npx vitest run scripts/__tests__/renderOrganizationJourney.test.ts`

Expected: FAIL with `ENOENT` for `docs/diagrams/vehicle-drive-log-organization-journey.html`.

- [ ] **Step 3: 승인 시안을 영구 HTML 원본으로 승격**

`apply_patch`로 `.superpowers/brainstorm/20260719-122407-24732/content/two-perspective-flow-v3.html`의 전체 내용을 변경 없이 `docs/diagrams/vehicle-drive-log-organization-journey.html`에 추가한다. 원본의 `.perspective-board`, 서비스 지원 띠, 관리자 6개 카드, 직원 5개 카드, 두 점선 인계 화살표와 관점별 도구 영역을 모두 보존한다.

- [ ] **Step 4: 콘텐츠 계약 테스트 통과 확인**

Run: `npx vitest run scripts/__tests__/renderOrganizationJourney.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: HTML 원본과 계약 테스트 커밋**

```bash
git add docs/diagrams/vehicle-drive-log-organization-journey.html scripts/__tests__/renderOrganizationJourney.test.ts
git commit -m "docs: 기관 운영 흐름도 HTML 원본 추가"
```

### Task 2: 재현 가능한 PNG 렌더러 구현

**Files:**
- Create: `scripts/render-organization-journey.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `docs/diagrams/vehicle-drive-log-organization-journey.html`
- Produces: `renderOrganizationJourney(outputPath?: string): Promise<void>`
- Default output: `docs/images/vehicle-drive-log-organization-journey.png`
- CLI: `npm run diagram:organization`

- [ ] **Step 1: Playwright 캡처와 Sharp 검증 렌더러 작성**

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(SCRIPT_PATH), '..');
const SOURCE_PATH = path.join(
  ROOT_DIR,
  'docs',
  'diagrams',
  'vehicle-drive-log-organization-journey.html',
);
export const DEFAULT_OUTPUT_PATH = path.join(
  ROOT_DIR,
  'docs',
  'images',
  'vehicle-drive-log-organization-journey.png',
);

export async function renderOrganizationJourney(
  outputPath = DEFAULT_OUTPUT_PATH,
): Promise<void> {
  const html = await readFile(SOURCE_PATH, 'utf8');
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      locale: 'ko-KR',
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const board = page.locator('.perspective-board');
    await board.waitFor({ state: 'visible' });
    const capture = await board.screenshot({ type: 'png' });

    await sharp(capture)
      .resize(3200, 1800, {
        fit: 'contain',
        background: '#f8fbfe',
        position: 'centre',
      })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(outputPath);
  } finally {
    await browser.close();
  }

  const metadata = await sharp(outputPath).metadata();
  if (
    metadata.format !== 'png' ||
    metadata.width !== 3200 ||
    metadata.height !== 1800
  ) {
    throw new Error(
      `Unexpected diagram output: ${metadata.format} ${metadata.width}x${metadata.height}`,
    );
  }
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === SCRIPT_PATH;

if (isDirectRun) {
  renderOrganizationJourney().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
```

- [ ] **Step 2: 패키지 생성 명령 추가**

`package.json`의 `scripts`에 다음 항목을 추가한다.

```json
"diagram:organization": "tsx scripts/render-organization-journey.ts"
```

- [ ] **Step 3: 구조 테스트와 타입 검사 실행**

Run: `npx vitest run scripts/__tests__/renderOrganizationJourney.test.ts`

Expected: 3 tests PASS.

Run: `npm run type-check`

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 4: 렌더러 커밋**

```bash
git add package.json scripts/render-organization-journey.ts
git commit -m "feat: 기관 운영 흐름도 PNG 렌더러 추가"
```

### Task 3: PNG 생성과 원본 크기 검증

**Files:**
- Create: `docs/images/vehicle-drive-log-organization-journey.png`
- Verify: `docs/superpowers/specs/2026-07-19-institution-admin-employee-operation-flow-design.md`

**Interfaces:**
- Consumes: `renderOrganizationJourney(outputPath?: string): Promise<void>`
- Produces: exact 3200×1800 PNG at `docs/images/vehicle-drive-log-organization-journey.png`

- [ ] **Step 1: 최종 PNG 생성**

Run: `npm run diagram:organization`

Expected: exit code 0 and `docs/images/vehicle-drive-log-organization-journey.png` created.

- [ ] **Step 2: 파일 형식과 크기 자동 검증**

Run: `npx tsx -e "import sharp from 'sharp'; const m=await sharp('docs/images/vehicle-drive-log-organization-journey.png').metadata(); if(m.format!=='png'||m.width!==3200||m.height!==1800) process.exit(1); console.log(m.format, m.width, m.height)"`

Expected: `png 3200 1800`.

- [ ] **Step 3: 원본 크기에서 시각 검증**

`view_image`로 `docs/images/vehicle-drive-log-organization-journey.png`를 원본 해상도로 열고 다음을 확인한다.

- 한글 제목과 역할 문구가 깨지거나 잘리지 않는다.
- 기관관리자와 기관직원이 첫 시선에서 파랑과 청록으로 구분된다.
- 관리자 6단계와 직원 5단계가 왼쪽에서 오른쪽으로 읽힌다.
- 시스템 운영은 상단 지원 영역으로만 보인다.
- 직원 초대 인계선은 아래로, 운행 기록 환류선은 위로 향한다.
- 기능 태그, 카드와 화살표가 서로 겹치지 않는다.

- [ ] **Step 4: 최종 회귀 검사**

Run: `npx vitest run scripts/__tests__/renderOrganizationJourney.test.ts`

Expected: 3 tests PASS.

Run: `npm run type-check`

Expected: exit code 0.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 5: PNG 결과물 커밋**

```bash
git add docs/images/vehicle-drive-log-organization-journey.png
git commit -m "docs: 기관관리자·직원 운영 흐름도 PNG 추가"
```
