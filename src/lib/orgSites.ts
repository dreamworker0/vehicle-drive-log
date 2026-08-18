/**
 * 출발지(차고지) 해석 — shared/orgSites.ts에서 re-export
 * 프론트엔드와 백엔드(Cloud Functions)가 같은 규칙으로 출발지를 정한다.
 * (규칙이 갈라지면 앱과 Slack 봇이 서로 다른 종료 시간을 제안한다)
 */
export {
    MAIN_SITE_ID, MAIN_SITE_NAME,
    resolveOrgSites, hasBranchSites, resolveVehicleSite,
    resolveDepartureAddress, resolveStartLocationLabel, createSiteId,
} from '../../shared/orgSites';
export type { OrgSite, OrgSiteFields } from '../../shared/orgSites';
