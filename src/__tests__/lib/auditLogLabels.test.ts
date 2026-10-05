/**
 * auditLogLabels — 접속기록 코드값을 사람이 읽는 말로
 *
 * 같은 필드 이름이라도 대상에 따라 뜻이 다르다(`status`: 사용자는 계정 상태, 예약은 예약 상태).
 * 화면과 엑셀이 같은 표를 쓰므로 여기서 한 번에 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { describeChangedFields, describeEvent } from '../../lib/auditLogLabels';

describe('auditLogLabels — 예약', () => {
    it('예약 기록은 "예약 생성·수정·삭제"로 읽힌다', () => {
        expect(describeEvent({ action: 'create', targetType: 'reservation' })).toBe('예약 생성');
        expect(describeEvent({ action: 'delete', targetType: 'reservation' })).toBe('예약 삭제');
    });

    it('예약의 status는 예약 상태, 사용자의 status는 계정 상태로 옮긴다', () => {
        expect(describeChangedFields(['status', 'startTime', 'passengerUids'], 'reservation'))
            .toBe('예약 상태, 시작 시각, 동승자');
        expect(describeChangedFields(['status'], 'user')).toBe('계정 상태');
        // 대상을 모르면 기존 표 그대로
        expect(describeChangedFields(['destination'])).toBe('목적지');
    });
});
