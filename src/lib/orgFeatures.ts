/**
 * orgFeatures — 기관별 기능 사용 토글 해석
 *
 * organization 문서의 *Enabled 플래그는 "미설정(undefined)=켜짐, false만 꺼짐" 규칙이다.
 * (기존 기관은 플래그가 없으므로 전부 켜진 상태로 동작 → 회귀 없음)
 */
import type { Organization } from '../types/organization';

export interface OrgFeatures {
    /** 하이패스 사용 */
    hipass: boolean;
    /** 수리·정비 사용 */
    maintenance: boolean;
    /** 수리·정비를 일반 직원도 사용(끄면 관리자 전용) */
    maintenanceEmployeeAccess: boolean;
    /** 차량별 사용 가능 직원 지정 사용 */
    allowedUsers: boolean;
    /** Google 캘린더 연동 사용 */
    googleCalendar: boolean;
    /** 운행일지 대표 운전자 지정(변경) 사용 */
    driverSelection: boolean;
    /** 운행일지 공동 운전자 사용 */
    coDriver: boolean;
    /** 운행일지 동승자 기록 사용 */
    passenger: boolean;
    /** 동승자: 직원 목록 직접 선택 허용 */
    passengerAllowList: boolean;
    /** 동승자: 검색으로 선택 허용 */
    passengerAllowSearch: boolean;
    /** 동승자: 인원 숫자 허용 */
    passengerAllowCount: boolean;
    /** 운전자(대표·공동): 목록 직접 선택 허용 */
    driverAllowList: boolean;
    /** 운전자(대표·공동): 검색 선택 허용. 둘 다 켜지면 후보 8명 기준 자동 전환 */
    driverAllowSearch: boolean;
}

/** 전 기능 켜짐 기본값(슈퍼관리자·기관 미구독 등). */
export const ALL_FEATURES_ON: OrgFeatures = {
    hipass: true,
    maintenance: true,
    maintenanceEmployeeAccess: true,
    allowedUsers: true,
    googleCalendar: true,
    driverSelection: true,
    coDriver: true,
    passenger: true,
    passengerAllowList: true,
    passengerAllowSearch: true,
    passengerAllowCount: true,
    driverAllowList: true,
    driverAllowSearch: true,
};

type OrgFeatureFields = Pick<
    Organization,
    'hipassEnabled' | 'maintenanceEnabled' | 'maintenanceEmployeeAccess' | 'allowedUsersEnabled' | 'googleCalendarEnabled'
    | 'driverSelectionEnabled' | 'coDriverEnabled' | 'passengerEnabled'
    | 'passengerAllowList' | 'passengerAllowSearch' | 'passengerAllowCount' | 'driverAllowList' | 'driverAllowSearch'
>;

/**
 * 기관 문서(또는 그 일부)에서 기능 사용 여부를 해석한다.
 * 각 플래그가 명시적으로 false일 때만 꺼짐으로 간주한다.
 */
export function resolveOrgFeatures(org?: Partial<OrgFeatureFields> | null): OrgFeatures {
    return {
        hipass: org?.hipassEnabled !== false,
        maintenance: org?.maintenanceEnabled !== false,
        maintenanceEmployeeAccess: org?.maintenanceEmployeeAccess !== false,
        allowedUsers: org?.allowedUsersEnabled !== false,
        googleCalendar: org?.googleCalendarEnabled !== false,
        driverSelection: org?.driverSelectionEnabled !== false,
        coDriver: org?.coDriverEnabled !== false,
        passenger: org?.passengerEnabled !== false,
        passengerAllowList: org?.passengerAllowList !== false,
        passengerAllowSearch: org?.passengerAllowSearch !== false,
        passengerAllowCount: org?.passengerAllowCount !== false,
        driverAllowList: org?.driverAllowList !== false,
        driverAllowSearch: org?.driverAllowSearch !== false,
    };
}
