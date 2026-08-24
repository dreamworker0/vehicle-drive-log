/**
 * 운영 스크립트는 **대상 프로젝트를 고정한 상태로만** Firebase Admin을 초기화한다.
 *
 * 왜 정적으로 강제하는가 — 이 결함은 **조용하다.** 프로젝트를 고정하지 않으면 Admin SDK가
 * 그 PC의 ADC 기본 프로젝트를 따라가고, 그것이 이 프로젝트가 아니면 엉뚱한 프로젝트를
 * 조회해 **에러 없이 0건**이 나온다. 조회 스크립트에서는 "없음"으로, 마이그레이션에서는
 * "고칠 것이 없음"으로 읽힌다. 실행한 사람은 실패한 줄 모른다.
 *
 * 2026-08-24에 실제로 발생했다 — quota project가 다른 프로젝트로 잡힌 PC에서
 * check-feedbacks.ts가 "등록된 피드백이 없습니다"를 출력했고(실제 136건), 그 값으로
 * "문의가 없다"는 판단을 내리려던 참이었다. 같은 날 점검에서 같은 누락이 스크립트 10개에
 * 더 있었고, 그중 5개는 쓰기 스크립트(백필·마이그레이션)였다.
 *
 * 새 스크립트는 `scripts/lib/adminApp.ts`의 `initAdminApp()`을 쓰면 된다. 특별한 사정이
 * 있으면 `initializeApp`에 `projectId`를 직접 넘겨도 통과한다 — 다만 **맨손
 * `initializeApp()`은 어떤 경우에도 통과하지 못한다.**
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 헬퍼 자신은 예외다 — 규칙을 구현하는 쪽이다. */
const HELPER = resolve(SCRIPTS, 'lib', 'adminApp.ts');

function collectTsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const full = resolve(dir, name);
        if (statSync(full).isDirectory()) {
            return name === '__tests__' ? [] : collectTsFiles(full);
        }
        return name.endsWith('.ts') ? [full] : [];
    });
}

/**
 * 주석을 걷어낸 소스.
 *
 * 이걸 하지 않으면 **주석 안의 문구가 코드로 잡힌다.** 실제로 이 테스트를 처음 돌렸을 때
 * "맨손 initializeApp()으로 넘어가던 것을 고쳤다"고 적어 둔 설명 주석 두 개가 위반으로
 * 잡혔다 — 규칙을 설명하는 문장이 규칙 위반으로 신고되는 상태였다.
 *
 * 줄 단위로 거른다(`//` 시작, JSDoc 본문 `*`, 줄 끝 `//` 뒤). 문자열 안에 `//`가 든 줄은
 * 뒤가 잘릴 수 있지만, 그 경우 생기는 것은 탐지 누락뿐이고 그런 줄에 초기화 호출이 함께
 * 있을 일은 없다.
 */
function stripComments(source: string): string {
    return source
        .split('\n')
        .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .map(line => line.replace(/\/\/.*$/, ''))
        .join('\n');
}

/** Admin 앱을 초기화하는 스크립트 목록 (파일 경로 → 주석을 걷어낸 원문) */
const initializers = collectTsFiles(SCRIPTS)
    .filter(f => f !== HELPER)
    .map(f => ({ path: relative(SCRIPTS, f), source: stripComments(readFileSync(f, 'utf8')) }))
    .filter(f => /initializeApp\s*\(/.test(f.source));

describe('운영 스크립트의 Admin 초기화', () => {
    it('Admin을 초기화하는 스크립트가 하나 이상 잡힌다 (탐색 자체가 깨지면 이 테스트가 무의미해진다)', () => {
        expect(initializers.length).toBeGreaterThan(5);
    });

    it('맨손 initializeApp() 이 없다 — ADC 기본 프로젝트를 따라가는 유일한 경로다', () => {
        const offenders = initializers
            .filter(f => /initializeApp\s*\(\s*\)/.test(f.source))
            .map(f => f.path);
        expect(offenders).toEqual([]);
    });

    it('모든 초기화가 프로젝트를 고정한다 (initAdminApp 사용 또는 projectId 직접 전달)', () => {
        const offenders = initializers
            .filter(f => !/from ['"]\.{1,2}\/(?:lib\/)?adminApp['"]/.test(f.source) && !/projectId/.test(f.source))
            .map(f => f.path);
        expect(offenders).toEqual([]);
    });

    it('헬퍼는 .firebaserc로 프로젝트를 정하고, 못 찾으면 경고한다', () => {
        const helper = readFileSync(HELPER, 'utf8'); // 원문 — 주석의 근거까지 확인한다
        expect(helper).toContain('.firebaserc');
        expect(helper).toMatch(/console\.warn/);
        // 고정에 실패한 상태를 조용히 넘기지 않는다는 것이 이 모듈의 전부다.
        expect(helper).toMatch(/projectId \? \{ projectId \} : \{\}/);
    });
});
