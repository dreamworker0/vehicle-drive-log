// 보안 감사 게이트(security-audit.ts)의 수용 등록부 판정 단위 테스트.
// 이 게이트는 pre-push·CI에서 하드 게이트로 쓰이므로, 수용 차감이 의도한 권고에만
// 적용되고 그 밖에는 fail-closed인지가 핵심 계약이다.
import { describe, it, expect } from 'vitest';
import { isAccepted, extractGhsa, validateRegistry } from '../security-audit';

/** 등록된 수용 권고 (react-router RSC CSRF) */
const ACCEPTED_ID = 'GHSA-qwww-vcr4-c8h2';
const ACCEPTED_URL = `https://github.com/advisories/${ACCEPTED_ID}`;
/** 미등록 권고 (실제로 있었던 brace-expansion DoS) */
const OTHER_URL = 'https://github.com/advisories/GHSA-mh99-v99m-4gvg';

describe('extractGhsa', () => {
    it('advisory URL에서 GHSA ID를 뽑는다', () => {
        expect(extractGhsa(ACCEPTED_URL)).toBe(ACCEPTED_ID);
    });

    it('말단 슬래시가 있어도 뽑는다', () => {
        expect(extractGhsa(`${ACCEPTED_URL}/`)).toBe(ACCEPTED_ID);
    });

    it('GHSA 형식이 아닌 말단 세그먼트는 null', () => {
        expect(extractGhsa('https://example.com/advisories/not-an-id')).toBeNull();
        expect(extractGhsa('https://github.com/advisories/GHSA')).toBeNull();
    });

    it('문자열이 아니면 null', () => {
        expect(extractGhsa(undefined)).toBeNull();
        expect(extractGhsa(null)).toBeNull();
        expect(extractGhsa(123)).toBeNull();
    });
});

describe('isAccepted — 수용 차감', () => {
    it('등록된 권고(직접 via 객체)는 차감한다', () => {
        expect(isAccepted({ severity: 'high', via: [{ url: ACCEPTED_URL }] })).toBe(true);
    });

    it('등록된 근본 패키지의 전이 항목(문자열 via)도 차감한다', () => {
        // react-router-dom의 via는 ["react-router"] 형태로 온다
        expect(isAccepted({ severity: 'high', via: ['react-router'] })).toBe(true);
    });
});

describe('isAccepted — fail-closed (게이트 우회 방지)', () => {
    it('미등록 권고는 차감하지 않는다', () => {
        expect(isAccepted({ severity: 'high', via: [{ url: OTHER_URL }] })).toBe(false);
    });

    it('미등록 패키지의 전이 항목은 차감하지 않는다', () => {
        expect(isAccepted({ severity: 'high', via: ['lodash'] })).toBe(false);
    });

    it('등록+미등록이 섞이면 차감하지 않는다', () => {
        expect(isAccepted({ severity: 'high', via: [{ url: ACCEPTED_URL }, { url: OTHER_URL }] })).toBe(false);
    });

    it('via가 없거나 비어 있으면 차감하지 않는다', () => {
        expect(isAccepted({ severity: 'high' })).toBe(false);
        expect(isAccepted({ severity: 'high', via: [] })).toBe(false);
    });

    it('via 원소가 null이거나 url이 없으면 차감하지 않는다', () => {
        expect(isAccepted({ severity: 'high', via: [null] })).toBe(false);
        expect(isAccepted({ severity: 'high', via: [{}] })).toBe(false);
    });

    it('권고 ID가 URL의 부분 문자열로만 일치하면 차감하지 않는다 (정확 일치 강제)', () => {
        // includes 매칭이었다면 통과했을 형태들
        expect(isAccepted({ severity: 'high', via: [{ url: `${ACCEPTED_URL}-extra` }] })).toBe(false);
        expect(isAccepted({ severity: 'high', via: [{ url: `https://evil.example/${ACCEPTED_ID}x` }] })).toBe(false);
    });

    it('수용 시점보다 심각도가 높게 재평가되면 차감하지 않는다', () => {
        // high로 수용한 권고가 critical로 올라가면 재평가가 필요하다
        expect(isAccepted({ severity: 'critical', via: [{ url: ACCEPTED_URL }] })).toBe(false);
    });

    it('심각도가 같거나 낮으면 차감을 유지한다', () => {
        expect(isAccepted({ severity: 'high', via: [{ url: ACCEPTED_URL }] })).toBe(true);
        expect(isAccepted({ severity: 'moderate', via: [{ url: ACCEPTED_URL }] })).toBe(true);
    });
});

describe('validateRegistry — 등록부 형식 강제', () => {
    it('현재 등록부는 유효하다', () => {
        expect(validateRegistry()).toEqual([]);
    });
});
