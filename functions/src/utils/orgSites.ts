/**
 * 출발지(차고지) 해석 — shared/orgSites.ts에서 re-export
 * 프론트엔드(예약 화면)와 여기(Slack 어시스턴트)가 같은 규칙으로 출발지를 정한다.
 */
export {
    MAIN_SITE_ID, MAIN_SITE_NAME,
    resolveOrgSites, hasBranchSites, resolveVehicleSite,
    resolveDepartureAddress, resolveStartLocationLabel,
} from "../../../shared/orgSites";
export type { OrgSite, OrgSiteFields } from "../../../shared/orgSites";
