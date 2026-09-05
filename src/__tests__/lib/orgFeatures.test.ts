import { describe, it, expect } from 'vitest';
import { resolveOrgFeatures, ALL_FEATURES_ON } from '../../lib/orgFeatures';

/**
 * 이 파일의 규칙은 "미설정(undefined)=켜짐, false만 꺼짐"이다.
 * **예외가 둘 있다** — `reservationPassenger`(예약 화면 동승자 입력)와
 * `refuelFlag`(주유·충전 필요 표시)는 opt-in이라 명시적으로 켠 기관에서만 true다.
 * 둘 다 전 직원이 매일 보는 화면에 새 입력란을 만들기 때문이다.
 * 아래 기대값에 그 예외가 반영돼 있다.
 */
const DEFAULTS_FOR_UNSET_ORG = { ...ALL_FEATURES_ON, reservationPassenger: false, refuelFlag: false };

describe('resolveOrgFeatures', () => {
    it('org가 없으면(undefined/null) opt-in 항목을 뺀 전부가 켜짐', () => {
        expect(resolveOrgFeatures(undefined)).toEqual(DEFAULTS_FOR_UNSET_ORG);
        expect(resolveOrgFeatures(null)).toEqual(DEFAULTS_FOR_UNSET_ORG);
    });

    it('플래그가 하나도 없으면(기존 기관) 전부 켜짐 + 입력 방식 모두 허용', () => {
        expect(resolveOrgFeatures({})).toEqual({
            hipass: true, maintenance: true, driverSelection: true, coDriver: true, passenger: true,
            passengerAllowList: true, passengerAllowSearch: true, passengerAllowCount: true,
            // 기존 기관의 예약 폼에 새 입력란이 예고 없이 나타나지 않아야 한다
            reservationPassenger: false,
            refuelFlag: false,
            driverAllowList: true, driverAllowSearch: true,
            maintenanceEmployeeAccess: true, allowedUsers: true, googleCalendar: true,
        });
    });

    it('입력 방식 플래그는 false만 꺼지고 미설정은 켜짐', () => {
        expect(resolveOrgFeatures({ passengerAllowCount: false })).toMatchObject({
            passengerAllowCount: false, passengerAllowList: true, passengerAllowSearch: true,
        });
        expect(resolveOrgFeatures({ driverAllowSearch: false })).toMatchObject({
            driverAllowSearch: false, driverAllowList: true,
        });
        expect(resolveOrgFeatures({ driverAllowList: false })).toMatchObject({
            driverAllowList: false, driverAllowSearch: true,
        });
    });

    it('명시적 true는 켜짐', () => {
        const f = resolveOrgFeatures({
            hipassEnabled: true, maintenanceEnabled: true, driverSelectionEnabled: true,
            coDriverEnabled: true, passengerEnabled: true, reservationPassengerEnabled: true,
            refuelFlagEnabled: true,
        });
        expect(f).toEqual(ALL_FEATURES_ON);
    });

    it('예약 동승자 입력은 opt-in — 명시적으로 켤 때만 true', () => {
        // 다른 플래그와 규칙이 반대라서 따로 고정한다. 이게 뒤집히면 모든 기관의
        // 예약 폼에 동승자 입력이 한꺼번에 나타난다.
        expect(resolveOrgFeatures({}).reservationPassenger).toBe(false);
        expect(resolveOrgFeatures({ reservationPassengerEnabled: false }).reservationPassenger).toBe(false);
        expect(resolveOrgFeatures({ reservationPassengerEnabled: true }).reservationPassenger).toBe(true);
    });

    it('false인 플래그만 꺼지고 나머지는 켜짐', () => {
        expect(resolveOrgFeatures({ hipassEnabled: false })).toEqual({
            hipass: false, maintenance: true, driverSelection: true, coDriver: true, passenger: true,
            passengerAllowList: true, passengerAllowSearch: true, passengerAllowCount: true,
            reservationPassenger: false,
            refuelFlag: false,
            driverAllowList: true, driverAllowSearch: true,
            maintenanceEmployeeAccess: true, allowedUsers: true, googleCalendar: true,
        });
        expect(resolveOrgFeatures({ maintenanceEnabled: false })).toMatchObject({ maintenance: false, hipass: true });
        expect(resolveOrgFeatures({ driverSelectionEnabled: false })).toMatchObject({ driverSelection: false });
        expect(resolveOrgFeatures({ coDriverEnabled: false })).toMatchObject({ coDriver: false });
        expect(resolveOrgFeatures({ passengerEnabled: false })).toMatchObject({ passenger: false });
    });

    it('여러 개를 동시에 꺼도 각각 반영', () => {
        expect(resolveOrgFeatures({ hipassEnabled: false, maintenanceEnabled: false })).toEqual({
            hipass: false, maintenance: false, driverSelection: true, coDriver: true, passenger: true,
            passengerAllowList: true, passengerAllowSearch: true, passengerAllowCount: true,
            reservationPassenger: false,
            refuelFlag: false,
            driverAllowList: true, driverAllowSearch: true,
            maintenanceEmployeeAccess: true, allowedUsers: true, googleCalendar: true,
        });
    });
});
