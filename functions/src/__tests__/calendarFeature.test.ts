/**
 * calendarFeature.test.ts — 기관 캘린더 플래그 조회 + 실행 단위 캐시
 *
 * 역동기화는 차량을 순회하며 차량마다 이 함수를 부른다. 한 기관에 차량이 여러 대면
 * 같은 organizations 문서를 대수만큼 다시 읽게 되는데, 스케줄이 평일 06~22시 30분
 * 주기(하루 34회)라 그 중복이 기관 수 × 차량 대수로 누적된다. 캐시가 그 중복을
 * 없애는지, 그리고 캐시를 넘기지 않은 호출은 매번 읽는지(= 신선도 유지) 고정한다.
 */

const mockOrgGet = jest.fn();

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: () => ({ doc: () => ({ get: mockOrgGet }) }),
    }),
}));

import { isGoogleCalendarEnabled, type OrgCalendarFlagCache } from '../services/calendar/calendarFeature';

/** googleCalendarEnabled 값을 가진 기관 문서 스냅샷 */
function orgSnap(enabled?: boolean) {
    return { exists: true, data: () => (enabled === undefined ? {} : { googleCalendarEnabled: enabled }) };
}

describe('isGoogleCalendarEnabled', () => {
    beforeEach(() => {
        mockOrgGet.mockReset();
    });

    it('명시적 false일 때만 끈다 — 필드가 없는 기존 기관은 켜진 것으로 본다', async () => {
        mockOrgGet.mockResolvedValue(orgSnap(undefined));
        await expect(isGoogleCalendarEnabled('org-1')).resolves.toBe(true);

        mockOrgGet.mockResolvedValue(orgSnap(false));
        await expect(isGoogleCalendarEnabled('org-1')).resolves.toBe(false);

        mockOrgGet.mockResolvedValue(orgSnap(true));
        await expect(isGoogleCalendarEnabled('org-1')).resolves.toBe(true);
    });

    it('기관 문서가 없으면 끈다', async () => {
        mockOrgGet.mockResolvedValue({ exists: false, data: () => undefined });
        await expect(isGoogleCalendarEnabled('missing-org')).resolves.toBe(false);
    });

    it('organizationId가 없으면 읽지 않고 바로 false', async () => {
        await expect(isGoogleCalendarEnabled(undefined)).resolves.toBe(false);
        expect(mockOrgGet).not.toHaveBeenCalled();
    });

    it('같은 캐시를 넘기면 같은 기관 문서를 한 번만 읽는다', async () => {
        mockOrgGet.mockResolvedValue(orgSnap(true));
        const cache: OrgCalendarFlagCache = new Map();

        // 한 기관에 차량 4대가 있는 상황
        for (let i = 0; i < 4; i++) {
            await expect(isGoogleCalendarEnabled('org-1', cache)).resolves.toBe(true);
        }

        expect(mockOrgGet).toHaveBeenCalledTimes(1);
    });

    it('캐시를 써도 기관별로는 각각 읽는다 — 서로의 값을 덮지 않는다', async () => {
        const cache: OrgCalendarFlagCache = new Map();
        mockOrgGet.mockResolvedValueOnce(orgSnap(true));   // org-1: 켜짐
        mockOrgGet.mockResolvedValueOnce(orgSnap(false));  // org-2: 꺼짐

        await expect(isGoogleCalendarEnabled('org-1', cache)).resolves.toBe(true);
        await expect(isGoogleCalendarEnabled('org-2', cache)).resolves.toBe(false);
        expect(mockOrgGet).toHaveBeenCalledTimes(2);

        // 두 번째 순회에서는 둘 다 캐시에서 나온다 (값이 섞이지 않는다)
        await expect(isGoogleCalendarEnabled('org-1', cache)).resolves.toBe(true);
        await expect(isGoogleCalendarEnabled('org-2', cache)).resolves.toBe(false);
        expect(mockOrgGet).toHaveBeenCalledTimes(2);
    });

    it('캐시는 false도 기억한다 — 꺼진 기관을 매번 다시 읽지 않는다', async () => {
        mockOrgGet.mockResolvedValue(orgSnap(false));
        const cache: OrgCalendarFlagCache = new Map();

        await expect(isGoogleCalendarEnabled('org-off', cache)).resolves.toBe(false);
        await expect(isGoogleCalendarEnabled('org-off', cache)).resolves.toBe(false);

        expect(mockOrgGet).toHaveBeenCalledTimes(1);
    });

    it('캐시를 넘기지 않으면 매번 읽는다 — 모듈 전역 캐시가 없어야 값이 굳지 않는다', async () => {
        // 관리자가 연동을 끈 직후에도 계속 켜진 값을 돌려주면 안 된다.
        mockOrgGet.mockResolvedValueOnce(orgSnap(true));
        await expect(isGoogleCalendarEnabled('org-1')).resolves.toBe(true);

        mockOrgGet.mockResolvedValueOnce(orgSnap(false));
        await expect(isGoogleCalendarEnabled('org-1')).resolves.toBe(false);

        expect(mockOrgGet).toHaveBeenCalledTimes(2);
    });
});
