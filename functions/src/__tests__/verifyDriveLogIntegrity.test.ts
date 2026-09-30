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
    // 직원을 영구 삭제하면 사용자 문서만 지우고 운행일지는 기관 기록으로 남긴다.
    // 2026-10-01 실제로 삭제된 직원 2명의 기록이 "없는 사용자"로 경고에 올라왔다.
    it('감사 로그로 삭제가 확인된 사용자의 기록은 위반이 아니라 보존 기록이다', () => {
        const logs: DriveLogLite[] = [
            { id: 'l9', organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'u_deleted' },
        ];
        const { violations, retained } = findReferenceIssues(logs, vehicleOrg, userOrg, new Set(['u_deleted']));
        expect(violations).toEqual([]);
        expect(retained).toHaveLength(1);
        expect(retained[0]).toContain('삭제된 사용자');
    });

    it('삭제 기록이 없는 없는 사용자는 여전히 위반이다', () => {
        const logs: DriveLogLite[] = [
            { id: 'l10', organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'u_ghost' },
        ];
        const { violations, retained } = findReferenceIssues(logs, vehicleOrg, userOrg, new Set(['u_other']));
        expect(retained).toEqual([]);
        expect(violations[0]).toContain('없는 사용자');
    });

    it('같은 기관의 실재하는 차량·운전자면 위반이 없다', () => {
        const logs: DriveLogLite[] = [
            { id: 'l1', organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'u_A' },
        ];
        expect(findReferenceIssues(logs, vehicleOrg, userOrg)).toEqual({ violations: [], transfers: [], retained: [] });
    });

    it('타 기관 차량을 참조하면 위반으로 잡는다 (F-02)', () => {
        const logs: DriveLogLite[] = [
            { id: 'l2', organizationId: 'org-A', vehicleId: 'v_B', driverUid: 'u_A' },
        ];
        const { violations: issues } = findReferenceIssues(logs, vehicleOrg, userOrg);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toContain('타 기관 차량');
        expect(issues[0]).toContain('l2');
    });

    it('타인이 타 기관 사용자를 운전자로 지정하면 위반으로 잡는다 (F-01)', () => {
        const logs: DriveLogLite[] = [
            { id: 'l3', organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'u_B', createdByUid: 'u_A' },
        ];
        const { violations: issues } = findReferenceIssues(logs, vehicleOrg, userOrg);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toContain('타 기관 사용자');
        expect(issues[0]).toContain('작성자=u_A');
    });

    // 사용자 소속은 clearUserOrganization → joinOrganization으로 바뀐다. 그때 과거 기관의
    // 기록이 남는 것은 정상이므로 위반으로 올리면 이동 한 번마다 경고가 뜬다.
    it('본인이 작성한 기록이면 소속 불일치를 기관 이동으로 분류한다', () => {
        const logs: DriveLogLite[] = [
            { id: 'l7', organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'u_B', createdByUid: 'u_B' },
        ];
        const { violations, transfers } = findReferenceIssues(logs, vehicleOrg, userOrg);
        expect(violations).toEqual([]);
        expect(transfers).toHaveLength(1);
        expect(transfers[0]).toContain('기관 이동');
        expect(transfers[0]).toContain('org-A');
        expect(transfers[0]).toContain('org-B');
    });

    it('작성자를 모르는 구 기록은 보수적으로 위반에 남긴다', () => {
        const logs: DriveLogLite[] = [
            { id: 'l8', organizationId: 'org-A', vehicleId: 'v_A', driverUid: 'u_B' },
        ];
        const { violations, transfers } = findReferenceIssues(logs, vehicleOrg, userOrg);
        expect(transfers).toEqual([]);
        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain('작성자=미상');
    });

    it('차량 소속 불일치는 본인 작성이어도 위반이다 (차량은 기관 이동 경로가 없다)', () => {
        const logs: DriveLogLite[] = [
            { id: 'l9', organizationId: 'org-A', vehicleId: 'v_B', driverUid: 'u_A', createdByUid: 'u_A' },
        ];
        const { violations, transfers } = findReferenceIssues(logs, vehicleOrg, userOrg);
        expect(transfers).toEqual([]);
        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain('타 기관 차량');
    });

    it('존재하지 않는 차량·운전자도 각각 위반으로 잡는다', () => {
        const logs: DriveLogLite[] = [
            { id: 'l4', organizationId: 'org-A', vehicleId: 'ghost', driverUid: 'nobody' },
        ];
        const { violations: issues } = findReferenceIssues(logs, vehicleOrg, userOrg);
        expect(issues).toHaveLength(2);
        expect(issues.join()).toContain('없는 차량');
        expect(issues.join()).toContain('없는 사용자');
    });

    it('소속이 null인 차량은 "없는 차량"이 아니라 소속 불일치로 잡는다', () => {
        // 키는 있지만 값이 undefined인 경우 — has()와 get()의 차이를 구분하지 못하면
        // 실재하는 차량을 "없는 차량"으로 오분류한다.
        const orphanVehicles = new Map<string, string | undefined>([['v_orphan', undefined]]);
        const logs: DriveLogLite[] = [{ id: 'l5', organizationId: 'org-A', vehicleId: 'v_orphan' }];
        const { violations: issues } = findReferenceIssues(logs, orphanVehicles, userOrg);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toContain('타 기관 차량');
        expect(issues[0]).not.toContain('없는 차량');
    });

    it('organizationId가 없는 기록은 판정 대상에서 제외한다', () => {
        const logs: DriveLogLite[] = [{ id: 'l6', vehicleId: 'v_B', driverUid: 'u_B' }];
        expect(findReferenceIssues(logs, vehicleOrg, userOrg)).toEqual({ violations: [], transfers: [], retained: [] });
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
