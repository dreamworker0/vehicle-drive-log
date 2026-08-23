/**
 * webFont — 폰트 스타일시트 주입 단위 테스트
 *
 * 고정하는 계약: 같은 문서에 두 번 붙지 않는다. 엔트리는 개발 중 HMR로 다시 실행되고
 * 테스트에서도 반복 호출되는데, 매번 <link>를 더하면 같은 CSS를 중복 요청하게 된다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadWebFont, WEB_FONT_HREF } from '../../lib/webFont';

const links = () => document.head.querySelectorAll(`link[href="${WEB_FONT_HREF}"]`);

describe('loadWebFont', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
    });

    it('폰트 스타일시트를 head에 붙인다', () => {
        loadWebFont();
        expect(links()).toHaveLength(1);
        expect(links()[0].getAttribute('rel')).toBe('stylesheet');
    });

    it('여러 번 불려도 하나만 남는다', () => {
        loadWebFont();
        loadWebFont();
        loadWebFont();
        expect(links()).toHaveLength(1);
    });

    it('자체 호스팅 경로를 쓴다 (제3자 호스트 금지 — 렌더 블로킹 왕복이 붙는다)', () => {
        expect(WEB_FONT_HREF.startsWith('/')).toBe(true);
    });
});
