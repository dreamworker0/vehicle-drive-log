/**
 * 본 웹 폰트가 **같은 오리진에서, 실제로 적용되는 상태로, 공개 랜딩 밖에서** 로드되는지
 * 정적으로 강제한다.
 *
 * 왜 필요한가 — 2026-08-23에 세 가지가 함께 드러났다.
 *  1) 폰트 스타일시트를 cdn.jsdelivr.net에서 받고 있었다. 스타일시트는 렌더 블로킹이므로
 *     첫 페인트가 제3자 호스트의 DNS+TCP+TLS(느린 4G에서 3 RTT) 뒤로 밀렸다. GitHub 러너
 *     실측 FCP 7.4~7.6초 / LCP 8.8~11.0초로, 주간 Lighthouse 게이트가 도입 이후 계속
 *     실패한 원인이었다.
 *  2) 그렇게 받은 폰트가 **적용되지도 않았다.** @font-face의 family는 'Pretendard Variable'
 *     인데 --font-sans에는 'Pretendard'만 적혀 있었다(정확히 일치해야 적용된다).
 *  3) 이름을 맞춰 적용하면 한글 동적 서브셋이 한 화면에 약 320KB를 붙여 랜딩이 느려진다
 *     (로컬 실측 performance 0.93 → 0.71). 그래서 폰트는 appEntry에서만 붙인다.
 *
 * 소스를 검사하는 이유: 세 결함 모두 **조용하다.** 잘못돼도 화면은 그려지고(폴백 서체),
 * 느려지는 것은 실제 회선에서만 드러난다. 사람 눈으로 잡을 수 없으므로 정적으로 못박는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const indexHtml = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const appCss = readFileSync(resolve(ROOT, 'src', 'index.css'), 'utf8');
const webFontTs = readFileSync(resolve(ROOT, 'src', 'lib', 'webFont.ts'), 'utf8');
const appEntry = readFileSync(resolve(ROOT, 'src', 'appEntry.tsx'), 'utf8');

/**
 * index.html의 `<link rel="stylesheet" href="...">` 목록.
 *
 * 정규식으로 태그를 긁지 않고 실제 파서에 맡긴다 — 주석 안의 예시 태그를 정규식으로
 * 걸러내려는 시도는 그 자체가 불완전한 처리이고(CodeQL js/incomplete-sanitization),
 * 파서는 주석·속성 순서·따옴표 종류를 이미 정확히 다룬다.
 */
function stylesheetHrefs(html: string): string[] {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('link[rel="stylesheet"]')]
        .map(link => link.getAttribute('href') ?? '');
}

/** webFont.ts가 선언한 폰트 CSS 경로 */
const fontHref = webFontTs.match(/WEB_FONT_HREF\s*=\s*'([^']+)'/)?.[1];

describe('본 웹 폰트 자체 호스팅', () => {
    it('index.html에는 스타일시트 <link>가 없다 (렌더 블로킹 요청은 랜딩에서 0개)', () => {
        expect(stylesheetHrefs(indexHtml)).toEqual([]);
    });

    it('index.html이 제3자 호스트에서 무언가를 받지 않는다', () => {
        expect(indexHtml).not.toContain('cdn.jsdelivr.net');
    });

    it('폰트는 appEntry(로그인 사용자용)에서만 붙인다', () => {
        expect(appEntry).toMatch(/loadWebFont\(\)/);
        const lightEntry = readFileSync(resolve(ROOT, 'src', 'lightEntry.tsx'), 'utf8');
        expect(lightEntry).not.toMatch(/loadWebFont/);
    });

    it('선언한 폰트 CSS가 public/에 실제로 있다', () => {
        expect(fontHref).toBeTruthy();
        expect(existsSync(resolve(ROOT, 'public', fontHref!.replace(/^\//, '')))).toBe(true);
    });

    describe('폰트 CSS 내용', () => {
        const cssPath = resolve(ROOT, 'public', (fontHref ?? '').replace(/^\//, ''));
        const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '';

        it('참조하는 woff2 조각이 하나도 빠지지 않았다 (누락 시 조용히 폴백 서체가 된다)', () => {
            const urls = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(m => m[1]);
            expect(urls.length).toBeGreaterThan(0);
            const missing = urls.filter(u => !existsSync(resolve(dirname(cssPath), u)));
            expect(missing).toEqual([]);
        });

        it('모든 @font-face가 font-display: swap이다 (텍스트 페인트가 폰트를 기다리지 않는다)', () => {
            const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
            expect(faces.length).toBeGreaterThan(0);
            expect(faces.filter(f => !/font-display:\s*swap/.test(f))).toEqual([]);
        });

        it('선언된 family가 --font-sans의 첫 항목이다 (이름이 어긋나면 폰트가 적용되지 않는다)', () => {
            const families = new Set(
                [...css.matchAll(/font-family:\s*'([^']+)'/g)].map(m => m[1])
            );
            expect(families.size).toBe(1);
            const declared = [...families][0];

            const fontSans = appCss.match(/--font-sans:\s*([^;]+);/);
            expect(fontSans).toBeTruthy();
            const first = fontSans![1].split(',')[0].trim().replace(/^['"]|['"]$/g, '');
            expect(first).toBe(declared);
        });

        it('OFL 라이선스 고지를 함께 둔다 (재배포 조건)', () => {
            expect(existsSync(resolve(dirname(cssPath), 'LICENSE.txt'))).toBe(true);
            expect(css).toContain('SIL Open Font License');
        });
    });

    it('폰트 조각을 서비스 워커 프리캐시에 넣지 않는다 (설치 즉시 3MB를 받게 된다)', () => {
        const viteConfig = readFileSync(resolve(ROOT, 'vite.config.js'), 'utf8');
        expect(viteConfig).toMatch(/globIgnores:\s*\[[^\]]*'fonts\/\*\*'/);
    });

    it('woff2에 불변 캐시 헤더가 붙는다 (경로에 버전이 있으므로 안전)', () => {
        const firebaseJson = readFileSync(resolve(ROOT, 'firebase.json'), 'utf8');
        const rule = JSON.parse(firebaseJson).hosting.headers
            .find((h: { source: string }) => h.source.includes('woff2'));
        expect(rule).toBeTruthy();
        expect(rule.headers[0].value).toContain('immutable');
    });
});
