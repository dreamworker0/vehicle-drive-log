/**
 * firestore/organizations — 초대 코드 생성 단위 테스트 (2026-08-23 감사 부록 1)
 *
 * 고정하는 계약: 초대 코드는 **암호학적 난수**로 만든다.
 * 초대 코드는 기관 데이터 전체를 여는 사실상 단일 자격증명이다 — 합류하면 그 기관의
 * 운행일지·직원 연락처·예약이 곧바로 열리고, 관리자가 없는 기관이면 합류자가 admin이 된다.
 * `Math.random()`은 예측 가능한 PRNG(V8 xorshift128+)라 여기에 쓰면 안 된다.
 *
 * 서버 쪽 정본(`functions/src/utils/inviteCode.ts`)과 알파벳·길이가 같아야 한다.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../lib/firebase', () => ({ db: {} }));
vi.mock('../../../lib/sentry', () => ({ captureError: vi.fn() }));

import { generateInviteCode } from '../../../lib/firestore/organizations';

/** 서버 정본과 같은 알파벳 (혼동 문자 0/O/1/I 제외 32자) */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

describe('generateInviteCode', () => {
    it('joinOrganization의 검증(6자)과 화면 안내에 맞는 길이·알파벳을 지킨다', () => {
        for (let i = 0; i < 200; i++) {
            const code = generateInviteCode();
            expect(code).toHaveLength(6);
            for (const ch of code) expect(ALPHABET).toContain(ch);
        }
    });

    it('Math.random()에 의존하지 않는다 — 예측 가능한 PRNG는 자격증명에 쓰지 않는다', () => {
        const spy = vi.spyOn(Math, 'random');
        generateInviteCode();
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('반복 생성이 겹치지 않는다 (충돌·상수 반환 회귀 감지)', () => {
        const codes = new Set(Array.from({ length: 500 }, () => generateInviteCode()));
        expect(codes.size).toBe(500);
    });
});
