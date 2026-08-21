/**
 * orgSites — 기관의 출발지(차고지) 해석 (프론트엔드 · Cloud Functions 공용 단일 원본)
 *
 * 기관 주소는 고유번호증에서 읽은 **본관 하나뿐**이었고, 예약·바로 운행의 경로 계산이
 * 그 주소를 출발지로 고정하고 있었다. 분관에 세워 둔 차량은 실제로 분관에서 출발하므로
 * 거리·소요시간·통행료가 모두 어긋난다.
 *
 * 그래서 기관 문서에 분관 목록(`sites`)을, 차량 문서에 그 차가 서 있는 출발지(`siteId`)를 둔다.
 * 본관은 목록에 저장하지 않는다 — 기관 주소가 곧 본관이고, 그 값은 증빙서류에서 온 것이라
 * 관리자가 고칠 수 없기 때문이다. 여기서만 "본관 + 분관들"로 합쳐 준다.
 */
/** 본관(기관 주소)의 고정 id. 분관 id와 겹치지 않도록 차량 폼·설정에서 예약어로 쓴다. */
export const MAIN_SITE_ID = 'main';

/** 본관 표시 이름 — 분관을 등록한 기관에서만 화면에 나온다. */
export const MAIN_SITE_NAME = '본관';

export interface OrgSite {
    id: string;
    name: string;
    address: string;
}

/**
 * 해석에 필요한 기관 문서의 최소 형태.
 *
 * `Organization` 타입을 직접 쓰지 않는 이유는 이 파일이 Cloud Functions에서도 그대로
 * 임포트되기 때문이다(functions는 Firestore 원시 문서를 다루고 프론트 타입을 모른다).
 * 구조만 요구하면 양쪽이 같은 규칙을 쓰면서도 서로의 타입에 묶이지 않는다.
 */
export interface OrgSiteFields {
    address?: string;
    sites?: Array<{ id: string; name?: string; address?: string }>;
}

/**
 * 기관의 출발지 목록 — 항상 본관이 첫 번째다.
 *
 * 이름·주소가 모두 빈 분관은 버린다(입력 도중 저장된 빈 행이 차량 폼의 선택지로 새는 것을 막는다).
 */
export function resolveOrgSites(org?: Partial<OrgSiteFields> | null): OrgSite[] {
    const main: OrgSite = {
        id: MAIN_SITE_ID,
        name: MAIN_SITE_NAME,
        address: (org?.address || '').trim(),
    };
    const branches = (org?.sites || [])
        .filter(s => s && s.id && ((s.name || '').trim() || (s.address || '').trim()))
        .map(s => ({
            id: s.id,
            name: (s.name || '').trim() || '이름 없는 출발지',
            address: (s.address || '').trim(),
        }));
    return [main, ...branches];
}

/** 기관에 분관이 하나라도 있는가 — 출발지 UI를 노출할지 판단하는 단일 기준. */
export function hasBranchSites(sites: OrgSite[]): boolean {
    return sites.length > 1;
}

/**
 * 차량이 출발하는 곳. `siteId`가 없거나 이미 지워진 분관을 가리키면 본관으로 되돌린다
 * (분관을 삭제해도 그 차량이 출발지 없는 상태로 남지 않는다).
 */
export function resolveVehicleSite(
    sites: OrgSite[],
    vehicle?: { siteId?: string } | null
): OrgSite {
    const found = vehicle?.siteId ? sites.find(s => s.id === vehicle.siteId) : undefined;
    return found || sites[0] || { id: MAIN_SITE_ID, name: MAIN_SITE_NAME, address: '' };
}

/**
 * 경로 탐색의 출발 주소. 분관에 주소를 안 적어 두었으면 본관 주소로 계산한다
 * (빈 문자열을 넘기면 경로 조회 자체가 사라져 예약 화면의 거리·시간이 통째로 없어진다).
 */
export function resolveDepartureAddress(
    sites: OrgSite[],
    vehicle?: { siteId?: string } | null
): string {
    const site = resolveVehicleSite(sites, vehicle);
    return site.address || sites[0]?.address || '';
}

/**
 * 운행일지에 남길 출발지 이름. 분관이 없는 기관에서는 적지 않는다 —
 * 모든 기록에 "본관"이 붙어 봐야 읽는 사람에게 새 정보가 없다.
 */
export function resolveStartLocationLabel(
    sites: OrgSite[],
    vehicle?: { siteId?: string } | null
): string | undefined {
    if (!hasBranchSites(sites)) return undefined;
    return resolveVehicleSite(sites, vehicle).name;
}

/** 새 분관 id — 기관 문서 안에서만 유일하면 된다. */
export function createSiteId(): string {
    return `site_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
