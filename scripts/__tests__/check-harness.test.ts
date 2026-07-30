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
});

describe('카탈로그 드리프트 판정', () => {
    // 13번 검사의 비교 규칙 자체를 고정한다 — 어느 방향의 누락이든 잡혀야 한다.
    const diff = (exported: string[], catalog: string[]) => ({
        missing: exported.filter((n) => !catalog.includes(n)),
        stale: catalog.filter((n) => !exported.includes(n)),
    });

    it('배포됐지만 문서에 없는 함수를 잡는다', () => {
        expect(diff(['a', 'b'], ['a']).missing).toEqual(['b']);
    });

    it('문서에만 남은 삭제된 함수를 잡는다', () => {
        expect(diff(['a'], ['a', 'archiveDriveLogs']).stale).toEqual(['archiveDriveLogs']);
    });

    it('일치하면 양방향 모두 비어 있다', () => {
        const r = diff(['a', 'b'], ['b', 'a']);
        expect([r.missing, r.stale]).toEqual([[], []]);
    });
});
