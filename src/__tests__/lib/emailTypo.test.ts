/**
 * emailTypo.test.ts — 신청 이메일 도메인 오타 추정
 */
import { describe, it, expect } from 'vitest';
import { suggestEmailFix } from '../../lib/emailTypo';

describe('suggestEmailFix', () => {
    it.each([
        ['sjb733@gmail.net', 'sjb733@gmail.com'],
        ['a@gmial.com', 'a@gmail.com'],
        ['a@gmail.con', 'a@gmail.com'],
        ['a@naver.net', 'a@naver.com'],
        ['a@nave.com', 'a@naver.com'],
        ['a@hanmail.com', 'a@hanmail.net'],
        ['a@daum.com', 'a@daum.net'],
        ['a@nate.net', 'a@nate.com'],
    ])('%s → %s', (input, expected) => {
        expect(suggestEmailFix(input)).toBe(expected);
    });

    it('도메인 대소문자·앞뒤 공백은 무시하고 아이디는 그대로 둔다', () => {
        expect(suggestEmailFix('  SJB733@Gmail.NET ')).toBe('SJB733@gmail.com');
    });

    it.each([
        ['a@gmail.com'],
        ['a@naver.com'],
        ['a@hanmail.net'],
        ['a@welfare.or.kr'], // 기관 자체 도메인은 건드리지 않는다
        ['a@gmall.kr'],
    ])('정상 도메인 %s은 제안하지 않는다', (input) => {
        expect(suggestEmailFix(input)).toBeNull();
    });

    it.each([[''], ['sjb733'], ['sjb733@'], ['@gmail.net']])('입력 중인 값 "%s"은 제안하지 않는다', (input) => {
        expect(suggestEmailFix(input)).toBeNull();
    });
});
