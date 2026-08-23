/**
 * inviteCode.test.ts — 초대 코드 생성 (2026-08-23 감사 부록 1)
 *
 * 고정하는 것: 초대 코드는 **암호학적 난수**로 만든다.
 * 초대 코드는 기관 데이터 전체를 여는 사실상 단일 자격증명이라(합류 즉시 운행일지·직원
 * 연락처 열람, 관리자 없는 기관이면 admin 획득) 예측 가능한 PRNG를 쓰면 안 된다.
 * `Math.random()`으로 되돌리면 이 테스트가 깨진다.
 */
import { generateInviteCode, INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from '../utils/inviteCode';

describe('generateInviteCode', () => {
    it('joinOrganization의 검증(6자)과 화면 안내에 맞는 길이·알파벳을 지킨다', () => {
        for (let i = 0; i < 200; i++) {
            const code = generateInviteCode();
            expect(code).toHaveLength(INVITE_CODE_LENGTH);
            for (const ch of code) expect(INVITE_CODE_ALPHABET).toContain(ch);
        }
    });

    it('혼동 문자(0·O·1·I)를 쓰지 않는다 — 전화로 받아 적는 코드다', () => {
        expect(INVITE_CODE_ALPHABET).not.toMatch(/[01OI]/);
        // 32자(2의 거듭제곱)여야 5비트 슬라이스에 모듈로 편향이 없다
        expect(INVITE_CODE_ALPHABET).toHaveLength(32);
        expect(new Set(INVITE_CODE_ALPHABET).size).toBe(32);
    });

    it('Math.random()에 의존하지 않는다 — 예측 가능한 PRNG는 자격증명에 쓰지 않는다', () => {
        const spy = jest.spyOn(Math, 'random');
        generateInviteCode();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('반복 생성이 겹치지 않는다 (충돌·상수 반환 회귀 감지)', () => {
        const codes = new Set(Array.from({ length: 500 }, () => generateInviteCode()));
        // 약 30비트 공간에서 500개면 충돌 확률은 무시할 수준이다
        expect(codes.size).toBe(500);
    });
});
