import { describe, it, expect } from 'vitest';
import { findVehicleNameAsDestination } from '../../hooks/driveLogForm/destinationGuard';

/**
 * 운행일지는 PDF·Excel로 뽑혀 지출결의·감사 서류가 된다. 그런데 목적지 칸은 예약에서 넘어온
 * 값으로 미리 채워지고, 제출 버튼은 차량·km만 본다 — 그럴듯하게 틀린 값은 그대로 굳는다.
 * 실제로 구글 캘린더 제목("스파크")이 목적지로 저장됐다(2026-09-15 이용 기관 신고).
 *
 * 회귀 지점은 **과잉 차단**이다. 부분 일치로 거르면 "스파크 정비소"라는 진짜 행선지가 죽는다.
 */
describe('findVehicleNameAsDestination — 목적지가 차량 이름인가', () => {
    const vehicle = { displayName: '스파크', name: 'Spark', plateNumber: '12가 3456' };

    it('표시 이름과 같으면 그 이름을 돌려준다', () => {
        expect(findVehicleNameAsDestination('스파크', vehicle)).toBe('스파크');
    });

    it('앞뒤 공백·중간 공백·대소문자를 무시하고 같게 본다', () => {
        expect(findVehicleNameAsDestination('  스파크 ', vehicle)).toBe('스파크');
        expect(findVehicleNameAsDestination('spark', vehicle)).toBe('Spark');
        expect(findVehicleNameAsDestination('12가3456', vehicle)).toBe('12가 3456');
    });

    it('차량명으로 시작할 뿐인 진짜 목적지는 통과시킨다 — 완전 일치만 본다', () => {
        expect(findVehicleNameAsDestination('스파크 정비소', vehicle)).toBeNull();
        expect(findVehicleNameAsDestination('스파', vehicle)).toBeNull();
    });

    it('목적지가 비었거나 차량 정보가 없으면 판정하지 않는다', () => {
        expect(findVehicleNameAsDestination('', vehicle)).toBeNull();
        expect(findVehicleNameAsDestination('   ', vehicle)).toBeNull();
        expect(findVehicleNameAsDestination('스파크', null)).toBeNull();
        expect(findVehicleNameAsDestination('스파크', {})).toBeNull();
    });

    it('이름 후보가 일부만 있어도 있는 것끼리 비교한다', () => {
        expect(findVehicleNameAsDestination('레이', { displayName: '레이' })).toBe('레이');
        expect(findVehicleNameAsDestination('레이', { plateNumber: '레이' })).toBe('레이');
    });
});
