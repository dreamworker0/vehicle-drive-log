// Gemini PR 리뷰어(gemini-pr-review.ts)의 순수 헬퍼 단위 테스트.
// 규칙 선택·의존성 모드 판정·diff 상한은 프롬프트 비용과 리뷰 품질을 동시에 좌우하므로 고정한다.
import { describe, it, expect } from 'vitest';
import {
    collectRules,
    isDepsOnly,
    touchesCiConfig,
    buildDiffSection,
    buildPrompt,
    type PrFile,
} from '../gemini-pr-review';

/** 테스트용 PR 파일 한 건. patch 길이만 중요한 경우 내용은 채움 문자로 만든다. */
function file(filename: string, patchLen = 10, status = 'modified'): PrFile {
    return { filename, status, additions: 1, deletions: 0, patch: 'x'.repeat(patchLen) };
}

describe('collectRules', () => {
    it('경로와 무관하게 coding-conventions를 항상 포함한다', () => {
        const names = collectRules(['README.txt']).map((r) => r.name);
        expect(names).toContain('coding-conventions.md');
    });

    it('functions/ 변경에는 cloud-functions 규칙을 붙인다', () => {
        const names = collectRules(['functions/src/handlers/https/foo.ts']).map((r) => r.name);
        expect(names).toContain('cloud-functions.md');
        expect(names).toContain('error-handling.md');
    });

    it('컴포넌트 변경에는 디자인 시스템·역할 경계 규칙을 붙인다', () => {
        const names = collectRules(['src/components/admin/VehicleForm.tsx']).map((r) => r.name);
        expect(names).toContain('design-system.md');
        expect(names).toContain('role-based-access.md');
    });

    it('firestore 도메인 파일에는 Rules·역할 규칙을 붙인다', () => {
        const names = collectRules(['src/lib/firestore/reservations.ts']).map((r) => r.name);
        expect(names).toContain('firestore-rules.md');
    });

    it('규칙을 중복해서 넣지 않는다', () => {
        const names = collectRules([
            'functions/src/a.ts',
            'functions/src/b.ts',
            'src/components/admin/C.tsx',
        ]).map((r) => r.name);
        expect(names.length).toBe(new Set(names).size);
    });

    it('실제 규칙 파일을 읽어 본문을 채운다', () => {
        // 파일이 사라지거나 이름이 바뀌면 프롬프트에서 조용히 빠지므로 본문 존재를 확인한다.
        const rules = collectRules(['functions/src/a.ts']);
        expect(rules.length).toBeGreaterThan(0);
        for (const r of rules) expect(r.text.length).toBeGreaterThan(0);
    });
});

describe('isDepsOnly', () => {
    it('package.json·lockfile만 바뀌면 의존성 모드다', () => {
        expect(isDepsOnly([file('package.json'), file('package-lock.json')])).toBe(true);
    });

    it('워크플로만 바뀌면 의존성 모드가 아니다 — 시크릿을 다루는 최고 권한 파일이라 코드 모드로 본다', () => {
        // 액션 버전 범프처럼 보여도 의존성 모드로 넘기면 "이 PR은 의존성 변경"이라는 틀린
        // 전제로 검토되고 코드 모드의 검사 목록이 빠진다.
        expect(isDepsOnly([file('.github/workflows/ci.yml')])).toBe(false);
    });

    it('manifest와 워크플로가 함께 바뀌면 의존성 모드다', () => {
        expect(isDepsOnly([file('package.json'), file('.github/workflows/ci.yml')])).toBe(true);
    });

    it('소스 변경이 섞이면 의존성 모드가 아니다', () => {
        expect(isDepsOnly([file('package.json'), file('src/lib/firestore/vehicles.ts')])).toBe(false);
    });

    it('변경 파일이 없으면 의존성 모드가 아니다', () => {
        expect(isDepsOnly([])).toBe(false);
    });
});

describe('touchesCiConfig', () => {
    it('.github/ 변경을 감지한다', () => {
        expect(touchesCiConfig([file('.github/workflows/deploy.yml')])).toBe(true);
        expect(touchesCiConfig([file('.github/dependabot.yml')])).toBe(true);
    });

    it('.github/ 밖의 변경만이면 false', () => {
        expect(touchesCiConfig([file('src/lib/notify.ts'), file('package.json')])).toBe(false);
    });
});

describe('buildDiffSection', () => {
    it('lockfile·생성물·바이너리를 리뷰 대상에서 뺀다', () => {
        const { text, notes } = buildDiffSection([
            file('package-lock.json'),
            file('.claude/skills/foo/SKILL.md'),
            file('public/icon.png'),
            file('src/lib/notify.ts'),
        ]);
        expect(text).toContain('src/lib/notify.ts');
        expect(text).not.toContain('package-lock.json');
        expect(text).not.toContain('.claude/');
        expect(notes.join(' ')).toMatch(/3건 제외/);
    });

    it('파일 수 상한을 넘기면 잘라내고 그 사실을 남긴다', () => {
        const many = Array.from({ length: 70 }, (_, i) => file(`src/a${i}.ts`));
        const { notes } = buildDiffSection(many);
        expect(notes.join(' ')).toMatch(/앞 60건만 검토/);
    });

    it('개별 파일 diff가 너무 길면 잘라낸다', () => {
        const { text } = buildDiffSection([file('src/big.ts', 20_000)]);
        expect(text).toContain('이 파일 diff 잘림');
        expect(text.length).toBeLessThan(20_000);
    });

    it('전체 diff 상한에 걸리면 이후 파일을 생략하고 알린다', () => {
        const big = Array.from({ length: 20 }, (_, i) => file(`src/b${i}.ts`, 11_000));
        const { notes } = buildDiffSection(big);
        expect(notes.join(' ')).toMatch(/전체 diff 상한/);
    });

    it('리뷰 대상이 없으면 빈 문자열을 준다 — 호출부가 이걸로 건너뛴다', () => {
        expect(buildDiffSection([file('package-lock.json')]).text).toBe('');
    });
});

describe('buildPrompt', () => {
    const base = {
        title: '제목',
        body: '본문',
        files: [file('src/lib/firestore/vehicles.ts')],
        diff: '--- src/lib/firestore/vehicles.ts\n+ 어떤 변경',
        claudeMd: '# CLAUDE.md 내용',
        rules: [{ name: 'coding-conventions.md', text: '규칙 본문' }],
    };

    it('CI가 이미 잡는 것을 지적하지 말라는 지시를 포함한다', () => {
        // 이 지시가 빠지면 리뷰가 lint·타입·테스트 중복 지적으로 뒤덮여 쓸모없어진다.
        const p = buildPrompt({ ...base, depsOnly: false });
        expect(p).toMatch(/CI가 이미 잡는 것은 지적하지 말라/);
    });

    it('diff를 지시문이 아니라 데이터로 다루라는 방어 지시를 포함한다', () => {
        const p = buildPrompt({ ...base, depsOnly: false });
        expect(p).toMatch(/데이터다/);
        expect(p).toMatch(/따르지 말고/);
    });

    it('코드 모드에서는 절대 규칙(organizationId 필터 등)을 최우선으로 지시한다', () => {
        const p = buildPrompt({ ...base, depsOnly: false });
        expect(p).toContain('organizationId');
        expect(p).toContain('functions/src/index.ts');
    });

    it('의존성 모드에서는 breaking change에 초점을 맞추고 절대 규칙 목록은 넣지 않는다', () => {
        const p = buildPrompt({ ...base, depsOnly: true });
        expect(p).toMatch(/breaking change/);
        expect(p).not.toContain('organizationId');
    });

    it('CLAUDE.md와 선택된 규칙 본문을 함께 싣는다', () => {
        const p = buildPrompt({ ...base, depsOnly: false });
        expect(p).toContain('# CLAUDE.md 내용');
        expect(p).toContain('규칙 본문');
        expect(p).toContain('.agent/rules/coding-conventions.md');
    });

    it('CLAUDE.md가 없으면 프롬프트가 깨지지 않는다', () => {
        const p = buildPrompt({ ...base, claudeMd: null, depsOnly: false });
        expect(p).toContain('(없음)');
    });

    it('.github/ 변경이면 head 체크아웃 회귀를 보라는 CI 초점을 붙인다', () => {
        // 이 블록이 빠지면 pull_request_target에 head 체크아웃이 되살아나는 변경을
        // 리뷰어가 그냥 통과시킨다 — 리뷰어 자신의 안전 조건이다.
        const p = buildPrompt({ ...base, depsOnly: false, ciConfig: true });
        expect(p).toContain('pull_request_target');
        expect(p).toMatch(/head\.sha/);
        expect(p).toContain('permissions:');
    });

    it('CI 초점은 의존성 모드에서도 붙는다 — 의존성 PR이 워크플로를 함께 건드릴 수 있다', () => {
        const p = buildPrompt({ ...base, depsOnly: true, ciConfig: true });
        expect(p).toMatch(/breaking change/);
        expect(p).toContain('pull_request_target');
    });

    it('.github/ 변경이 없으면 CI 초점을 붙이지 않는다', () => {
        const p = buildPrompt({ ...base, depsOnly: false, ciConfig: false });
        expect(p).not.toContain('pull_request_target');
    });
});
