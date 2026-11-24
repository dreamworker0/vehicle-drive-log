/**
 * public/theme-init.js — React 마운트 전 theme-color 초기화
 *
 * CSP script-src의 'unsafe-inline'을 닫으려고 index.html 인라인 스크립트를 외부 파일로 옮겼다
 * (2026-11-24). 동작은 예전 인라인과 같아야 하고, localStorage가 막힌 환경에서도 던지지 않아야 한다
 * (동기 스크립트라 예외가 나면 콘솔 오류가 남는다).
 */
import { describe, it, expect } from 'vitest';
import SOURCE from '../../../public/theme-init.js?raw';
import INDEX_HTML from '../../../index.html?raw';

type Env = { stored: string | null; prefersDark: boolean; storageThrows?: boolean };

function run(env: Env): string {
    const meta = { content: '#f8fafc' };
    const localStorage = {
        getItem: () => {
            if (env.storageThrows) throw new Error('SecurityError');
            return env.stored;
        },
    };
    const window = { matchMedia: () => ({ matches: env.prefersDark }) };
    const document = { querySelector: (sel: string) => (sel === 'meta[name="theme-color"]' ? meta : null) };
    new Function('localStorage', 'window', 'document', SOURCE)(localStorage, window, document);
    return meta.content;
}

describe('theme-init.js', () => {
    it.each([
        { stored: 'dark', prefersDark: false, expected: '#020617' },
        { stored: 'light', prefersDark: true, expected: '#f8fafc' },
        { stored: null, prefersDark: true, expected: '#020617' },
        { stored: null, prefersDark: false, expected: '#f8fafc' },
        { stored: 'system', prefersDark: true, expected: '#020617' },
    ])('저장값 $stored · 시스템 다크 $prefersDark → $expected', ({ stored, prefersDark, expected }) => {
        expect(run({ stored, prefersDark })).toBe(expected);
    });

    it('localStorage가 막혀도 던지지 않고 기본(라이트) 색을 둔다', () => {
        expect(() => run({ stored: null, prefersDark: true, storageThrows: true })).not.toThrow();
        expect(run({ stored: null, prefersDark: true, storageThrows: true })).toBe('#f8fafc');
    });
});

describe('index.html — CSP에서 unsafe-inline 없이 동작하는 마크업', () => {
    it('src 없는 인라인 <script>가 없다 (script-src에 unsafe-inline이 없으므로 차단된다)', () => {
        const scripts = INDEX_HTML.match(/<script\b[^>]*>/g) ?? [];
        expect(scripts.length).toBeGreaterThan(0);
        for (const tag of scripts) expect(tag).toMatch(/\ssrc=/);
    });

    it('theme-init.js는 defer·async 없이 싣는다 (첫 페인트 전에 실행돼야 한다)', () => {
        const tag = (INDEX_HTML.match(/<script\b[^>]*theme-init\.js[^>]*>/) ?? [''])[0];
        expect(tag).not.toBe('');
        expect(tag).not.toMatch(/\b(defer|async)\b/);
    });
});
