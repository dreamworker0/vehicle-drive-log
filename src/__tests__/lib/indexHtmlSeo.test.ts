/**
 * index.html 정적 SEO 태그 — 페이지별 태그(SEOHead)와 겹치지 않아야 하는 것
 *
 * canonical을 index.html에 두면 모든 공개 페이지에 홈(/) canonical이 하나 더 남아,
 * 검색엔진이 하위 페이지를 홈으로 합칠 수 있었다(2026-11-25 수정). og:*는 JS를 실행하지 않는
 * 링크 미리보기용이라 정적으로 남는 것이 맞다.
 */
import { describe, it, expect } from 'vitest';
import INDEX_HTML from '../../../index.html?raw';

const withoutComments = INDEX_HTML.replace(/<!--[\s\S]*?-->/g, '');

describe('index.html 정적 SEO 태그', () => {
    it('canonical 링크를 두지 않는다 — 페이지마다 SEOHead가 붙인다', () => {
        expect(withoutComments).not.toMatch(/<link[^>]+rel=["']canonical["']/i);
    });

    it('링크 미리보기용 og 태그는 정적으로 남긴다', () => {
        expect(withoutComments).toMatch(/<meta property="og:title"/);
        expect(withoutComments).toMatch(/<meta property="og:image"/);
    });
});
