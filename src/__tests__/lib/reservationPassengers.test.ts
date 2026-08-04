/**
 * reservationPassengers — 예약 동승자(예정)의 조립·복원
 *
 * 고정하는 계약: **저장한 그대로 되돌아온다.** 예약 저장 · 예약 수정 복원 ·
 * 운행일지 prefill 세 곳이 같은 규칙을 쓰므로, 여기가 어긋나면
 * "적어 둔 사람과 채워지는 사람이 다른" 상태가 된다.
 */
import { describe, it, expect } from 'vitest';
import {
    composeReservationPassengers,
    resolveReservationPassengers,
    parseExternalNames,
    memberDisplayName,
    MAX_PASSENGERS,
} from '../../hooks/utils/reservationPassengers';
import type { User as UserDoc } from '../../types/user';

const members = [
    { id: 'u1', name: '홍길동' },
    { id: 'u2', name: '김철수' },
    { id: 'u3', email: 'lee@test.local' },
] as unknown as UserDoc[];

describe('parseExternalNames', () => {
    it('쉼표로 나누고 공백·빈 항목·중복을 걸러낸다', () => {
        expect(parseExternalNames(' 박영희 , , 최민수,박영희 ')).toEqual(['박영희', '최민수']);
    });

    it('비어 있으면 빈 배열', () => {
        expect(parseExternalNames('')).toEqual([]);
        expect(parseExternalNames(undefined)).toEqual([]);
    });
});

describe('memberDisplayName', () => {
    it('이름이 없으면 이메일 로컬파트를 쓴다', () => {
        expect(memberDisplayName(members[2])).toBe('lee');
    });
});

describe('composeReservationPassengers', () => {
    it('조직원 이름과 직접 입력 이름을 하나의 명단으로 합친다', () => {
        const result = composeReservationPassengers(
            { passengerUids: ['u1', 'u2'], passengerExternalNames: '박영희', passengerCount: 2 },
            members,
        );
        expect(result).toEqual({
            passengerUids: ['u1', 'u2'],
            passengerNames: ['홍길동', '김철수', '박영희'],
            passengerCount: 2,
        });
    });

    it('값이 없으면 필드를 만들지 않는다 (문서를 키우지 않는다)', () => {
        expect(composeReservationPassengers({}, members)).toEqual({});
    });

    it('clearWhenEmpty면 빈 값을 명시적으로 내보낸다', () => {
        // 수정에서 동승자를 모두 지운 경우. undefined로 두면 updateReservation이 걸러 내
        // **지운 동승자가 문서에 그대로 남는다.**
        expect(composeReservationPassengers({}, members, { clearWhenEmpty: true })).toEqual({
            passengerUids: [],
            passengerNames: [],
            passengerCount: 0,
        });
    });

    it('기관에 없는 uid는 버린다', () => {
        const result = composeReservationPassengers({ passengerUids: ['u1', '탈퇴한계정'] }, members);
        expect(result.passengerUids).toEqual(['u1']);
        expect(result.passengerNames).toEqual(['홍길동']);
    });

    it('인원 수는 0 이상 정수로 정규화한다', () => {
        expect(composeReservationPassengers({ passengerCount: -3 }, members)).toEqual({});
        expect(composeReservationPassengers({ passengerCount: 2.7 }, members).passengerCount).toBe(2);
    });

    it('이름 명단은 상한을 넘지 않는다', () => {
        const many = Array.from({ length: 60 }, (_, i) => `사람${i}`).join(', ');
        const result = composeReservationPassengers({ passengerExternalNames: many }, members);
        expect(result.passengerNames).toHaveLength(MAX_PASSENGERS);
    });
});

describe('resolveReservationPassengers', () => {
    it('uid로 조직원을 찾고 나머지 이름은 직접 입력으로 되돌린다', () => {
        const result = resolveReservationPassengers(
            { passengerUids: ['u1'], passengerNames: ['홍길동', '박영희'], passengerCount: 1 },
            members,
        );
        expect(result.selected.map(m => m.id)).toEqual(['u1']);
        expect(result.externalNames).toEqual(['박영희']);
        expect(result.count).toBe(1);
    });

    it('uid가 없어도 이름이 맞으면 조직원으로 복원한다 (구 데이터·개명 대비)', () => {
        const result = resolveReservationPassengers({ passengerNames: ['김철수'] }, members);
        expect(result.selected.map(m => m.id)).toEqual(['u2']);
        expect(result.externalNames).toEqual([]);
    });

    it('퇴사해 목록에 없는 uid의 이름은 사라지지 않고 직접 입력으로 남는다', () => {
        const result = resolveReservationPassengers(
            { passengerUids: ['퇴사자'], passengerNames: ['이퇴사'] },
            members,
        );
        expect(result.selected).toEqual([]);
        expect(result.externalNames).toEqual(['이퇴사']);
    });

    it('예약이 없으면 빈 결과', () => {
        expect(resolveReservationPassengers(null, members)).toEqual({ selected: [], externalNames: [], count: 0 });
    });

    it('저장 → 복원이 왕복해도 같은 값이다', () => {
        const form = { passengerUids: ['u1', 'u3'], passengerExternalNames: '박영희, 최민수', passengerCount: 2 };
        const stored = composeReservationPassengers(form, members);
        const restored = resolveReservationPassengers(stored, members);

        expect(restored.selected.map(m => m.id)).toEqual(['u1', 'u3']);
        expect(restored.externalNames.join(', ')).toBe('박영희, 최민수');
        expect(restored.count).toBe(2);
    });
});
