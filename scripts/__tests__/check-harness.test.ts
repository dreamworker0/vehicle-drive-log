// 하네스 Doctor(check-harness.ts)의 파서·판정 헬퍼 단위 테스트.
import { describe, it, expect } from 'vitest';
import {
    parseFrontmatter,
    extractRelativeLinks,
    hashResults,
    findPwshChainingIssues,
    extractNpmRunScripts,
    extractFunctionExports,
    extractCatalogNames,
    diffCatalogNames,
    extractInlineCodePaths,
    extractScriptCommandPaths,
    extractQuotedMdRefs,
    extractHookScriptPaths,
    findForbiddenDeployCommands,
    countTestInventory,
    extractDocumentedTestInventory,
} from '../check-harness';

describe('parseFrontmatter', () => {
    it('name/description을 추출한다', () => {
        const md = '---\nname: my-skill\ndescription: 설명 텍스트\n---\n\n# 본문';
        expect(parseFrontmatter(md)).toEqual({ name: 'my-skill', description: '설명 텍스트' });
    });

    it('따옴표를 벗긴다', () => {
        const md = '---\nname: "quoted"\ndescription: \'단일\'\n---\n';
        expect(parseFrontmatter(md)).toEqual({ name: 'quoted', description: '단일' });
    });

    it('frontmatter가 없으면 빈 객체', () => {
        expect(parseFrontmatter('# 제목뿐')).toEqual({});
    });

    it('빈 description은 undefined 취급', () => {
        const md = '---\nname: x\ndescription:\n---\n';
        expect(parseFrontmatter(md).description).toBeUndefined();
    });

    it('CRLF 줄바꿈도 처리한다', () => {
        const md = '---\r\nname: crlf\r\ndescription: 윈도우\r\n---\r\n';
        expect(parseFrontmatter(md)).toEqual({ name: 'crlf', description: '윈도우' });
    });
});

describe('extractRelativeLinks', () => {
    it('상대 링크만 추출하고 http/앵커/메일은 제외한다', () => {
        const md = [
            '[규칙](../rules/a.md) [외부](https://x.com) [앵커](#sec)',
            '[메일](mailto:a@b.c) [스킬](skills/x/SKILL.md#part)',
        ].join('\n');
        expect(extractRelativeLinks(md)).toEqual(['../rules/a.md', 'skills/x/SKILL.md']);
    });

    it('코드 블록·인라인 코드 안의 링크는 무시한다', () => {
        const md = '```\n[예시](fake/path.md)\n```\n`[inline](x.md)`\n[진짜](real.md)';
        expect(extractRelativeLinks(md)).toEqual(['real.md']);
    });
});

describe('hashResults', () => {
    it('키 순서와 무관하게 같은 해시를 낸다', () => {
        const a = hashResults({ '2': 'x', '1': 'y' });
        const b = hashResults({ '1': 'y', '2': 'x' });
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{16}$/);
    });

    it('값이 다르면 해시가 달라진다', () => {
        expect(hashResults({ '1': 'pass' })).not.toBe(hashResults({ '1': 'fail' }));
    });
});

describe('findPwshChainingIssues', () => {
    it('powershell 블록 안의 &&를 잡는다', () => {
        const md = '```powershell\nnpm run a && npm run b\n```';
        expect(findPwshChainingIssues(md)).toEqual(['npm run a && npm run b']);
    });

    it('bash 블록이나 본문의 &&는 무시한다', () => {
        const md = '```bash\na && b\n```\n본문 && 언급\n```powershell\nnpm test\n```';
        expect(findPwshChainingIssues(md)).toEqual([]);
    });
});

describe('findForbiddenDeployCommands', () => {
    it('Firebase CLI 직접 배포 명령의 줄 번호를 찾는다', () => {
        const markdown = [
            '# 운영',
            'firebase deploy --only functions',
            'npx firebase-tools deploy --only hosting',
        ].join('\n');

        expect(findForbiddenDeployCommands(markdown)).toEqual([2, 3]);
    });

    it('CI 배포 설명과 셀프호스팅 링크는 차단하지 않는다', () => {
        const markdown = [
            'master 푸시 후 CI Deploy 워크플로를 확인한다.',
            '[셀프호스팅](docs/SELF_HOSTING.md)을 참고한다.',
        ].join('\n');

        expect(findForbiddenDeployCommands(markdown)).toEqual([]);
    });
});

describe('테스트 규모 문서 정합성', () => {
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
        expect(
            countTestInventory([
                'src/__tests__/a.test.ts',
                'scripts/__tests__/b.test.ts',
                'scripts/hooks/__tests__/guard.test.mjs',
                'eslint-rules/local-rule.test.js',
                'functions/src/__tests__/c.test.ts',
                'functions/src/__tests__/d.emulator.test.ts',
                'tests/firestore-rules.test.ts',
                'tests/storage-rules.test.ts',
                'e2e/login.spec.ts',
            ]),
        ).toEqual({
            frontendFiles: 4,
            functionSuites: 1,
            rulesFiles: 2,
            e2eSpecs: 1,
        });
    });
});

describe('extractNpmRunScripts', () => {
    it('npm run 스크립트명을 추출한다', () => {
        const md = 'npm run build 후 npm.cmd run type-check && npm run sync:agents';
        expect(extractNpmRunScripts(md)).toEqual(['build', 'type-check', 'sync:agents']);
    });

    it('npm test 등 run 없는 형태는 대상이 아니다', () => {
        expect(extractNpmRunScripts('npm test; npm install')).toEqual([]);
    });
});

describe('extractFunctionExports', () => {
    it('한 줄·여러 개·여러 줄 export를 모두 뽑는다', () => {
        const src = [
            '// 주석',
            'export { ocrDashboard } from "./handlers/callable/ocrDashboard";',
            'export { onReservationCreated, onReservationUpdated } from "./handlers/triggers/reservationTriggers";',
            'export {',
            '    auditUserCreated, auditUserUpdated,',
            '} from "./handlers/triggers/auditLog";',
        ].join('\n');
        expect(extractFunctionExports(src)).toEqual([
            'ocrDashboard',
            'onReservationCreated',
            'onReservationUpdated',
            'auditUserCreated',
            'auditUserUpdated',
        ]);
    });

    it('as 별칭은 배포 이름(별칭 쪽)을 취한다', () => {
        expect(extractFunctionExports('export { internalName as deployedName } from "./x";')).toEqual([
            'deployedName',
        ]);
    });

    it('import나 로컬 export는 함수 export로 세지 않는다', () => {
        const src = 'import { getFirestore } from "firebase-admin/firestore";\nexport const NOT_A_FN = 1;';
        expect(extractFunctionExports(src)).toEqual([]);
    });
});

describe('extractCatalogNames', () => {
    it('카탈로그 항목의 name만 뽑는다', () => {
        const src = [
            'const FUNCTIONS: FunctionEntry[] = [',
            '  {',
            "    name: 'ocrDashboard',",
            "    type: 'onCall',",
            "    file: 'handlers/callable/ocrDashboard.ts',",
            "    description: '설명 안의 name: 가짜 표기',",
            '  },',
            '  {',
            "    name: 'askAI',",
            "    type: 'onCall',",
            '  },',
            '];',
        ].join('\n');
        expect(extractCatalogNames(src)).toEqual(['ocrDashboard', 'askAI']);
    });

    it('따옴표 스타일이 바뀌어도 뽑는다', () => {
        // 작은따옴표만 받으면 재포맷 시 빈 배열이 되고 13번 검사가 "전부 누락"으로 CI를 잘못 막는다.
        const src = ["    name: 'single',", '    name: "double",', '    name: `backtick`,'].join('\n');
        expect(extractCatalogNames(src)).toEqual(['single', 'double', 'backtick']);
    });
});

describe('diffCatalogNames', () => {
    // 13번 검사가 그대로 호출하는 함수를 직접 검증한다 (재구현 테스트는 본체를 지워도 통과한다).
    it('배포됐지만 문서에 없는 함수를 잡는다', () => {
        expect(diffCatalogNames(['a', 'b'], ['a']).missing).toEqual(['b']);
    });

    it('문서에만 남은 삭제된 함수를 잡는다', () => {
        expect(diffCatalogNames(['a'], ['a', 'archiveDriveLogs']).stale).toEqual(['archiveDriveLogs']);
    });

    it('카탈로그 중복을 잡는다', () => {
        expect(diffCatalogNames(['a'], ['a', 'a']).duplicates).toEqual(['a']);
    });

    it('일치하면 세 목록 모두 비어 있다', () => {
        const r = diffCatalogNames(['a', 'b'], ['b', 'a']);
        expect([r.missing, r.stale, r.duplicates]).toEqual([[], [], []]);
    });
});

describe('extractInlineCodePaths', () => {
    it('알려진 루트로 시작하는 인라인 백틱 경로만 뽑는다', () => {
        const md = '정본은 `src/lib/sentry.ts`다. `notifyUser`는 경로가 아니다. `handlers/callable/x.ts`는 루트 밖 조각.';
        expect(extractInlineCodePaths(md)).toEqual(['src/lib/sentry.ts']);
    });

    it('펜스 코드 블록 안의 경로는 예시로 보고 제외한다', () => {
        const md = '```\n`src/fake/example.ts`\nsrc/other.ts\n```\n본문 `functions/src/index.ts`';
        expect(extractInlineCodePaths(md)).toEqual(['functions/src/index.ts']);
    });

    it('글롭·플레이스홀더·줄번호 꼬리·후행 슬래시를 처리한다', () => {
        const md = [
            '`scripts/migrate*.ts` `functions/src/{handlers,utils}/` `src/components/<role>/`',
            '`src/lib/sentry.ts:295` `.agent/rules/` `docs/security-reports/YYYY-MM-DD.md`',
        ].join('\n');
        expect(extractInlineCodePaths(md)).toEqual(['src/lib/sentry.ts', '.agent/rules']);
    });

    it('gitignore 대상(.env 계열, settings.local.json)은 검사하지 않는다', () => {
        const md = '`functions/.env` `src/.env.local` `.claude/settings.local.json` `.claude/settings.json`';
        expect(extractInlineCodePaths(md)).toEqual(['.claude/settings.json']);
    });
});

describe('extractScriptCommandPaths', () => {
    it('tsx/node 실행 명령의 스크립트 경로를 펜스 안까지 뽑는다', () => {
        const md = [
            '```bash',
            'npx tsx scripts/test-calendar-sync.ts --uid={test-uid}',
            'node scripts/hooks/lint-changed.mjs',
            '```',
            '본문에서 tsx scripts/run-eval.ts 언급',
        ].join('\n');
        expect(extractScriptCommandPaths(md)).toEqual([
            'scripts/test-calendar-sync.ts',
            'scripts/run-eval.ts',
            'scripts/hooks/lint-changed.mjs',
        ]);
    });

    it('스크립트 실행이 아닌 언급은 뽑지 않는다', () => {
        expect(extractScriptCommandPaths('`scripts/foo.ts` 파일과 node_modules 이야기')).toEqual([]);
    });
});

describe('extractQuotedMdRefs', () => {
    it('따옴표로 감싼 소문자 케밥 규칙 파일명만 뽑고 중복을 제거한다', () => {
        const src = "rules: ['cloud-functions.md', 'error-handling.md']; x = 'cloud-functions.md'; readIfExists('CLAUDE.md')";
        expect(extractQuotedMdRefs(src)).toEqual(['cloud-functions.md', 'error-handling.md']);
    });
});

describe('extractHookScriptPaths', () => {
    it('훅 명령에서 로컬 스크립트 경로를 뽑고 $CLAUDE_PROJECT_DIR 접두를 벗긴다', () => {
        const settings = JSON.stringify({
            hooks: {
                SessionStart: [{ hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"' }] }],
                PostToolUse: [
                    {
                        matcher: 'Edit|Write',
                        hooks: [
                            { type: 'command', command: 'node scripts/hooks/lint-changed.mjs' },
                            { type: 'command', command: 'echo no-path-here' },
                        ],
                    },
                ],
            },
        });
        expect(extractHookScriptPaths(settings)).toEqual([
            '.claude/hooks/session-start.sh',
            'scripts/hooks/lint-changed.mjs',
        ]);
    });

    it('hooks가 없으면 빈 배열', () => {
        expect(extractHookScriptPaths('{"permissions":{}}')).toEqual([]);
    });
});
