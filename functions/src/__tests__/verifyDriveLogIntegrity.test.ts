/**
 * verifyDriveLogIntegrity.test.ts
 *
 * 월간 운행일지 정합성 검증의 판정 규칙 단위 테스트.
 * 참조 무결성 검사는 2026-07 감사 F-01/F-02(임의 driverUid 지정, 교차기관 vehicleId
 * 참조)를 위험 수용하면서 전제로 삼은 보완 통제다 — Rules는 no-get 원칙 때문에
 * create 시점에 이 둘을 검증하지 않으므로, 여기서 탐지하지 못하면 탐지 수단이 없다.
 */
import { findReferenceIssues, countMileageGaps, type DriveLogLite } from '../handlers/scheduled/verifyMileageConsistency';

const vehicleOrg = new Map<string, string | undefined>([
    ['v_A', 'org-A'],
    ['v_B', 'org-B'],
]);
const userOrg = new Map<string, string | undefined>([
    ['u_A', 'org-A'],
    ['u_B', 'org-B'],
]);

describe('findReferenceIssues — 참조 무결성 (F-01/F-02 탐지)', () => {
    it('같은 기관의 실재하는 차량·운전자면 위반이 없다', () => {
        const logs: DriveLogLite[] = [
            { id: 'l1', organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'u_A' },
        ];
        expect(findReferenceIssues(logs, vehicleOrg, userOrg)).toEqual([]);
    });

    it('타 기관 차량을 참조하면 위반으로 잡는다 (F-02)', () => {
        const logs: DriveLogLite[] = [
            { id: 'l2', organizationId: 'org-A', vehicleId: 'v_B', driverUid: 'u_A' },
        ];
        const issues = findReferenceIssues(logs, vehicleOrg, userOrg);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toContain('타 기관 차량');
        expect(issues[0]).toContain('l2');
    });

    it('타 기관 사용자를 운전자로 지정하면 위반으로 잡는다 (F-01)', () => {
        const logs: DriveLogLite[] = [
            { id: 'l3', organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'u_B' },
        ];
        const issues = findReferenceIssues(logs, vehicleOrg, userOrg);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toContain('타 기관 사용자');
    });

    it('존재하지 않는 차량·운전자도 각각 위반으로 잡는다', () => {
        const logs: DriveLogLite[] = [
            { id: 'l4', organizationId: 'org-A', vehicleId: 'ghost', driverUid: 'nobody' },
        ];
        const issues = findReferenceIssues(logs, vehicleOrg, userOrg);
        expect(issues).toHaveLength(2);
        expect(issues.join()).toContain('없는 차량');
        expect(issues.join()).toContain('없는 사용자');
    });

    it('소속이 null인 차량은 "없는 차량"이 아니라 소속 불일치로 잡는다', () => {
        // 키는 있지만 값이 undefined인 경우 — has()와 get()의 차이를 구분하지 못하면
        // 실재하는 차량을 "없는 차량"으로 오분류한다.
        const orphanVehicles = new Map<string, string | undefined>([['v_orphan', undefined]]);
        const logs: DriveLogLite[] = [{ id: 'l5', organizationId: 'org-A', vehicleId: 'v_orphan' }];
        const issues = findReferenceIssues(logs, orphanVehicles, userOrg);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toContain('타 기관 차량');
        expect(issues[0]).not.toContain('없는 차량');
    });

    it('organizationId가 없는 기록은 판정 대상에서 제외한다', () => {
        const logs: DriveLogLite[] = [{ id: 'l6', vehicleId: 'v_B', driverUid: 'u_B' }];
        expect(findReferenceIssues(logs, vehicleOrg, userOrg)).toEqual([]);
    });
});

describe('countMileageGaps — 마일리지 연속성', () => {
    beforeEach(() => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('도착 km가 다음 출발 km와 이어지면 불일치가 없다', () => {
        const logs: DriveLogLite[] = [
            { id: 'a', organizationId: 'org-A', vehicleId: 'v_A', startKm: 100, endKm: 150 },
            { id: 'b', organizationId: 'org-A', vehicleId: 'v_A', startKm: 150, endKm: 200 },
        ];
        expect(countMileageGaps(logs)).toBe(0);
    });

    it('중간에 끊기면 불일치로 센다', () => {
        const logs: DriveLogLite[] = [
            { id: 'a', organizationId: 'org-A', vehicleId: 'v_A', startKm: 100, endKm: 150 },
            { id: 'b', organizationId: 'org-A', vehicleId: 'v_A', startKm: 170, endKm: 200 },
        ];
        expect(countMileageGaps(logs)).toBe(1);
    });

    it('입력 순서가 뒤섞여 있어도 startKm 기준으로 정렬해 비교한다', () => {
        const logs: DriveLogLite[] = [
            { id: 'b', organizationId: 'org-A', vehicleId: 'v_A', startKm: 150, endKm: 200 },
            { id: 'a', organizationId: 'org-A', vehicleId: 'v_A', startKm: 100, endKm: 150 },
        ];
        expect(countMileageGaps(logs)).toBe(0);
    });

    it('다른 차량·다른 기관의 기록끼리는 비교하지 않는다', () => {
        const logs: DriveLogLite[] = [
            { id: 'a', organizationId: 'org-A', vehicleId: 'v_A', startKm: 100, endKm: 150 },
            { id: 'b', organizationId: 'org-A', vehicleId: 'v_B', startKm: 900, endKm: 950 },
            { id: 'c', organizationId: 'org-B', vehicleId: 'v_A', startKm: 500, endKm: 550 },
        ];
        expect(countMileageGaps(logs)).toBe(0);
    });

    it('km가 없는 기록은 비교에서 빼되 나머지는 그대로 이어본다', () => {
        const logs: DriveLogLite[] = [
            { id: 'a', organizationId: 'org-A', vehicleId: 'v_A', startKm: 100, endKm: 150 },
            { id: 'draft', organizationId: 'org-A', vehicleId: 'v_A', startKm: 150 },
            { id: 'b', organizationId: 'org-A', vehicleId: 'v_A', startKm: 150, endKm: 200 },
        ];
        expect(countMileageGaps(logs)).toBe(0);
    });
});
