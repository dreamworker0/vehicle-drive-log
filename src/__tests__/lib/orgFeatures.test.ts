import { describe, it, expect } from 'vitest';
import { resolveOrgFeatures, ALL_FEATURES_ON } from '../../lib/orgFeatures';

describe('resolveOrgFeatures', () => {
    it('org가 없으면(undefined/null) 전부 켜짐', () => {
        expect(resolveOrgFeatures(undefined)).toEqual(ALL_FEATURES_ON);
        expect(resolveOrgFeatures(null)).toEqual(ALL_FEATURES_ON);
    });

    it('플래그가 하나도 없으면(기존 기관) 전부 켜짐 + 입력 방식 모두 허용', () => {
        expect(resolveOrgFeatures({})).toEqual({
            hipass: true, maintenance: true, driverSelection: true, coDriver: true, passenger: true,
            passengerAllowList: true, passengerAllowSearch: true, passengerAllowCount: true,
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
            coDriverEnabled: true, passengerEnabled: true,
        });
        expect(f).toEqual(ALL_FEATURES_ON);
    });

    it('false인 플래그만 꺼지고 나머지는 켜짐', () => {
        expect(resolveOrgFeatures({ hipassEnabled: false })).toEqual({
            hipass: false, maintenance: true, driverSelection: true, coDriver: true, passenger: true,
            passengerAllowList: true, passengerAllowSearch: true, passengerAllowCount: true,
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
            driverAllowList: true, driverAllowSearch: true,
            maintenanceEmployeeAccess: true, allowedUsers: true, googleCalendar: true,
        });
    });
});
