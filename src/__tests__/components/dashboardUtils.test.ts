/**
 * dashboardUtils.test.ts
 * - mapNotifTypeCounts: 원시 알림 type 카운트 → 한글 라벨 + 색상 + 정렬 매핑 검증
 *   (라이브 로더·서버 캐시 경로가 공유하는 표시 매핑 단일 소스)
 */
import { describe, it, expect } from 'vitest';
import { mapNotifTypeCounts, NOTIF_TYPE_COLORS, quickDriveTrackedNote } from '../../components/superAdmin/dashboard/dashboardUtils';

describe('mapNotifTypeCounts', () => {
    it('알려진 type은 한글 라벨과 고정 색상으로 매핑한다', () => {
        const r = mapNotifTypeCounts([{ type: 'admin_notice', count: 3 }]);
        expect(r).toEqual([{ type: '관리자 공지', count: 3, color: NOTIF_TYPE_COLORS.admin_notice }]);
    });

    it('미지의 type은 원문 유지 + 폴백 팔레트 색상을 배정한다', () => {
        const r = mapNotifTypeCounts([{ type: 'unknown_type', count: 1 }]);
        expect(r[0].type).toBe('unknown_type');
        expect(r[0].color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('count 내림차순으로 정렬한다', () => {
        const r = mapNotifTypeCounts([
            { type: 'notice', count: 1 },
            { type: 'approval', count: 5 },
            { type: 'system', count: 3 },
        ]);
        expect(r.map(x => x.count)).toEqual([5, 3, 1]);
        expect(r[0].type).toBe('승인');
    });

    it('빈 입력이면 빈 배열을 반환한다', () => {
        expect(mapNotifTypeCounts([])).toEqual([]);
    });
});

describe('quickDriveTrackedNote', () => {
    it('최근 30일 창이 9/23보다 앞서면 안내를 돌려준다', () => {
        expect(quickDriveTrackedNote(new Date(2026, 9, 1))).toContain('9/23부터 집계');
        expect(quickDriveTrackedNote(new Date(2026, 9, 21))).not.toBeNull(); // 창 시작 9/22
    });

    it('창이 9/23 이후로 넘어가면 안내가 사라진다', () => {
        expect(quickDriveTrackedNote(new Date(2026, 9, 22))).toBeNull(); // 창 시작 9/23
        expect(quickDriveTrackedNote(new Date(2026, 11, 1))).toBeNull();
    });
});
