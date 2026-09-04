import { describe, it, expect } from 'vitest';
import {
    resolveOrgSites,
    resolveVehicleSite,
    resolveVehicleCurrentSite,
    resolveDepartureAddress,
    resolveCurrentDepartureAddress,
    resolveStartLocationLabel,
    hasBranchSites,
    canChooseSite,
    createSiteId,
    MAIN_SITE_ID,
} from '../../lib/orgSites';

/**
 * 회귀 지점은 두 가지다.
 * ① 분관을 등록하지 않은 기존 기관은 **하나도 달라지지 않아야 한다**(출발지=기관 주소, 기록에 출발지 없음).
 * ② 분관을 지우거나 주소를 비워 둔 상태에서도 경로 탐색의 출발 주소가 비지 않아야 한다 —
 *    빈 주소를 넘기면 예약 화면의 거리·소요시간이 통째로 사라진다.
 */
const ORG = {
    address: '서울시 본관로 1',
    sites: [
        { id: 'site_a', name: '제2분관', address: '경기도 분관로 2' },
        { id: 'site_b', name: '주소없는분관', address: '' },
    ],
};

describe('resolveOrgSites', () => {
    it('본관(기관 주소)이 항상 첫 번째다', () => {
        const sites = resolveOrgSites(ORG);
        expect(sites[0]).toEqual({ id: MAIN_SITE_ID, name: '본관', address: '서울시 본관로 1' });
        expect(sites).toHaveLength(3);
    });

    it('기관 정보가 없어도 본관 한 개는 나온다', () => {
        expect(resolveOrgSites(null)).toEqual([{ id: MAIN_SITE_ID, name: '본관', address: '' }]);
    });

    it('이름·주소가 모두 빈 줄은 버린다 — 차량 폼의 선택지로 새지 않는다', () => {
        const sites = resolveOrgSites({ address: '가', sites: [{ id: 'site_x', name: '  ', address: '  ' }] });
        expect(sites).toHaveLength(1);
    });
});

describe('hasBranchSites', () => {
    it('분관이 없으면 false — 출발지 UI를 띄우지 않는 기준', () => {
        expect(hasBranchSites(resolveOrgSites({ address: '가' }))).toBe(false);
        expect(hasBranchSites(resolveOrgSites(ORG))).toBe(true);
    });
});

describe('resolveVehicleSite', () => {
    const sites = resolveOrgSites(ORG);

    it('siteId가 없으면 본관', () => {
        expect(resolveVehicleSite(sites, {}).id).toBe(MAIN_SITE_ID);
        expect(resolveVehicleSite(sites, null).id).toBe(MAIN_SITE_ID);
    });

    it('지정한 분관을 찾는다', () => {
        expect(resolveVehicleSite(sites, { siteId: 'site_a' }).name).toBe('제2분관');
    });

    it('이미 삭제된 분관을 가리키면 본관으로 되돌린다', () => {
        expect(resolveVehicleSite(sites, { siteId: 'site_deleted' }).id).toBe(MAIN_SITE_ID);
    });
});

describe('resolveDepartureAddress', () => {
    const sites = resolveOrgSites(ORG);

    it('분관 차량은 분관 주소에서 출발한다', () => {
        expect(resolveDepartureAddress(sites, { siteId: 'site_a' })).toBe('경기도 분관로 2');
    });

    it('분관에 주소를 안 적었으면 본관 주소로 계산한다 (빈 출발지로 경로가 사라지지 않게)', () => {
        expect(resolveDepartureAddress(sites, { siteId: 'site_b' })).toBe('서울시 본관로 1');
    });

    it('분관이 없는 기관은 기관 주소 그대로', () => {
        expect(resolveDepartureAddress(resolveOrgSites({ address: '서울시 본관로 1' }), {})).toBe('서울시 본관로 1');
    });
});

describe('resolveStartLocationLabel', () => {
    it('분관이 없는 기관의 운행일지에는 출발지를 적지 않는다', () => {
        expect(resolveStartLocationLabel(resolveOrgSites({ address: '가' }), {})).toBeUndefined();
    });

    it('분관이 있으면 본관 출발도 이름을 남긴다', () => {
        const sites = resolveOrgSites(ORG);
        expect(resolveStartLocationLabel(sites, {})).toBe('본관');
        expect(resolveStartLocationLabel(sites, { siteId: 'site_a' })).toBe('제2분관');
    });
});

describe('canChooseSite', () => {
    const branchSites = resolveOrgSites(ORG);
    const mainOnly = resolveOrgSites({ address: '서울시 본관로 1' });

    it('분관이 없으면 siteVaries가 켜져 있어도 false — 고를 대상이 하나뿐이다', () => {
        expect(canChooseSite(mainOnly, { siteVaries: true })).toBe(false);
    });

    it('분관이 있어도 siteVaries가 꺼져 있으면 false — 기존 기관 대다수가 이 경우다', () => {
        expect(canChooseSite(branchSites, { siteVaries: false })).toBe(false);
        expect(canChooseSite(branchSites, {})).toBe(false);
        expect(canChooseSite(branchSites, null)).toBe(false);
    });

    it('분관이 있고 siteVaries가 켜졌을 때만 true', () => {
        expect(canChooseSite(branchSites, { siteVaries: true })).toBe(true);
    });
});

describe('resolveVehicleCurrentSite', () => {
    const sites = resolveOrgSites(ORG);

    it('현재 위치가 유효하면 그 출발지를 돌려준다', () => {
        expect(resolveVehicleCurrentSite(sites, { siteId: MAIN_SITE_ID, currentSiteId: 'site_a' }).name).toBe('제2분관');
    });

    it('현재 위치가 없으면 기본 차고지로 되돌아간다', () => {
        expect(resolveVehicleCurrentSite(sites, { siteId: 'site_a' }).name).toBe('제2분관');
    });

    it('이미 삭제된 분관을 가리키면 기본 차고지 → 본관 순으로 되돌린다', () => {
        expect(resolveVehicleCurrentSite(sites, { siteId: 'site_a', currentSiteId: 'site_deleted' }).name).toBe('제2분관');
        expect(resolveVehicleCurrentSite(sites, { currentSiteId: 'site_deleted' }).id).toBe(MAIN_SITE_ID);
        expect(resolveVehicleCurrentSite(sites, null).id).toBe(MAIN_SITE_ID);
    });
});

describe('resolveCurrentDepartureAddress', () => {
    const sites = resolveOrgSites(ORG);

    it('현재 위치 주소에서 출발한다', () => {
        expect(resolveCurrentDepartureAddress(sites, { currentSiteId: 'site_a' })).toBe('경기도 분관로 2');
    });

    it('현재 위치에 주소를 안 적었으면 본관 주소로 계산한다 (빈 출발지로 경로가 사라지지 않게)', () => {
        expect(resolveCurrentDepartureAddress(sites, { currentSiteId: 'site_b' })).toBe('서울시 본관로 1');
    });

    it('현재 위치가 없으면 기본 차고지 주소를 쓴다', () => {
        expect(resolveCurrentDepartureAddress(sites, { siteId: 'site_a' })).toBe('경기도 분관로 2');
    });
});

describe('createSiteId', () => {
    it('연속 호출해도 서로 다른 id를 만든다', () => {
        expect(createSiteId()).not.toBe(createSiteId());
    });
});
