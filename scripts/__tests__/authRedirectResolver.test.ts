/**
 * Auth 리다이렉트 리졸버 규약 — 초기화에서 빼고, 쓰는 곳에서 넘긴다
 *
 * `getAuth()`는 `popupRedirectResolver: browserPopupRedirectResolver`를 기본으로 붙이고,
 * 그 리졸버는 **페이지 로드 중에** apis.google.com/js/api.js와 숨은 iframe을 받아 온다.
 * auth 초기화 모듈은 랜딩·로그인(lightEntry)의 임계 경로에 있고 랜딩 방문자는 대부분
 * 로그인하지 않으므로, 2026-08-24 러너 실측에서 이것이 랜딩에 남은 마지막 제3자 요청이었다.
 *
 * 그래서 리졸버 없이 초기화하고 실제 로그인 함수에만 인자로 넘긴다. 이 규약은 **깨지면
 * 로그인이 죽는다**(리졸버 없이 부르면 auth/argument-error). 그런데 그 실패는 로컬
 * 에뮬레이터 경로(이메일/비밀번호)에서는 재현되지 않아 단위·E2E 테스트를 통과한다 —
 * 사람이 실제 구글 로그인을 눌러 봐야 드러난다. 그래서 정적으로 못박는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

/** src 아래 모든 .ts/.tsx 파일 (테스트 파일 제외) */
function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            if (name === '__tests__') continue;
            out.push(...sourceFiles(path));
        } else if (/\.tsx?$/.test(name)) {
            out.push(path);
        }
    }
    return out;
}

const FILES = sourceFiles(SRC);

/** 리졸버를 반드시 인자로 받아야 하는 Firebase Auth 함수들 */
const NEEDS_RESOLVER = ['signInWithPopup', 'signInWithRedirect', 'getRedirectResult'] as const;

describe('Auth 리다이렉트 리졸버 규약', () => {
    it('firebase/auth에서 getAuth를 가져오지 않는다 (리졸버가 기본으로 붙는다)', () => {
        // 주석에 적힌 `getAuth()` 설명에 걸리지 않도록 **import 구문만** 본다.
        // 리졸버가 딸린 초기화를 하려면 이 심볼을 가져와야 하므로 판정에 충분하다.
        const offenders = FILES.filter((f) => {
            const source = readFileSync(f, 'utf8');
            return [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'firebase\/auth'/g)]
                .some(m => /\bgetAuth\b/.test(m[1]));
        }).map(f => relative(SRC, f));
        expect(offenders).toEqual([]);
    });

    it('firebase.ts는 auth를 firebaseAuth.ts에서 가져온다 (초기화 주체는 한 곳)', () => {
        const source = readFileSync(resolve(SRC, 'lib', 'firebase.ts'), 'utf8');
        expect(source).toMatch(/import\s*\{[^}]*\bauth\b[^}]*\}\s*from\s*'\.\/firebaseAuth'/);
    });

    it.each(NEEDS_RESOLVER)('%s 호출에는 browserPopupRedirectResolver를 넘긴다', (fn) => {
        const calls: string[] = [];
        for (const file of FILES) {
            const source = readFileSync(file, 'utf8');
            // 호출부만 본다 — import 구문의 이름 나열은 제외한다
            for (const m of source.matchAll(new RegExp(`\\b${fn}\\s*\\(([^)]*)\\)`, 'g'))) {
                if (!m[1].includes('browserPopupRedirectResolver')) {
                    calls.push(`${relative(SRC, file)}: ${m[0]}`);
                }
            }
        }
        expect(calls).toEqual([]);
    });
});
