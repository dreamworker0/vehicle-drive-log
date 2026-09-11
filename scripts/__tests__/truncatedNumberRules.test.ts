/**
 * truncatedNumberRules 단위 테스트
 *
 * 이 규칙의 실패 모드는 두 방향이다.
 *  - **놓치는 쪽**: 잘린 값을 정상으로 보고 넘긴다 → 사용자는 끝내 모른다.
 *  - **덮어쓰는 쪽**: 멀쩡한 값(0·음수·정상 금액)까지 후보로 올린다 → 후보가 많아지면
 *    사람이 훑기를 포기하고, 그 순간 점검은 없는 것과 같아진다.
 * 그래서 양쪽을 다 고정한다.
 */
import { describe, it, expect } from 'vitest';
import {
    AUDITED_COLLECTIONS,
    findTruncationCandidates,
    floorRulesFor,
    fuelUnitPrice,
} from '../lib/truncatedNumberRules';

describe('findTruncationCandidates — 주유·충전 기록', () => {
    /** parseInt('1e5') === 1 이던 시절에 남을 수 있는 모양 */
    const truncated = { date: '2026-07-02', fuelAmount: 40, fuelCost: 1, meterReading: 51000 };

    it('금액이 1원이면 후보로 올린다', () => {
        const [found] = findTruncationCandidates('fuelLogs', truncated);
        expect(found.field).toBe('fuelCost');
        expect(found.value).toBe(1);
    });

    it('주유량 대비 단가가 터무니없으면 확신도를 높음으로 올린다', () => {
        const [found] = findTruncationCandidates('fuelLogs', truncated);
        expect(found.confidence).toBe('high');
        // 근거에 단가를 적어야 사람이 화면을 열지 말지 판단할 수 있다
        expect(found.reason).toContain('단가');
    });

    it('정상 주유 기록은 후보로 올리지 않는다', () => {
        expect(findTruncationCandidates('fuelLogs', {
            fuelAmount: 40, fuelCost: 60000, meterReading: 51000,
        })).toEqual([]);
    });

    it('주유미터가 잘린 경우도 잡는다', () => {
        const found = findTruncationCandidates('fuelLogs', { fuelAmount: 40, fuelCost: 60000, meterReading: 5 });
        expect(found).toHaveLength(1);
        expect(found[0].field).toBe('meterReading');
    });

    it('주유량(fuelAmount)은 보지 않는다 — 처음부터 Number 기반이라 이 버그의 영향이 없다', () => {
        const found = findTruncationCandidates('fuelLogs', { fuelAmount: 0.5, fuelCost: 60000, meterReading: 51000 });
        expect(found).toEqual([]);
    });
});

describe('findTruncationCandidates — 멀쩡한 값을 올리지 않는다', () => {
    it('0은 미입력으로 보고 건너뛴다', () => {
        expect(findTruncationCandidates('maintenanceRecords', { cost: 0, km: 0 })).toEqual([]);
    });

    it('음수는 건너뛴다 — check-negative-values의 몫이라 두 번 세지 않는다', () => {
        expect(findTruncationCandidates('fuelLogs', { fuelCost: -60000 })).toEqual([]);
    });

    it('NaN·문자열·없는 필드는 건너뛴다', () => {
        expect(findTruncationCandidates('fuelLogs', { fuelCost: NaN })).toEqual([]);
        expect(findTruncationCandidates('fuelLogs', { fuelCost: '1' })).toEqual([]);
        expect(findTruncationCandidates('fuelLogs', {})).toEqual([]);
    });

    it('바닥값 경계(딱 그 값)는 후보가 아니다', () => {
        expect(findTruncationCandidates('hipassCharges', { chargeAmount: 1000 })).toEqual([]);
        expect(findTruncationCandidates('hipassCharges', { chargeAmount: 999 })).toHaveLength(1);
    });

    it('점검 대상이 아닌 컬렉션은 빈 배열을 돌려준다', () => {
        expect(findTruncationCandidates('driveLogs', { startKm: 1, endKm: 2 })).toEqual([]);
    });
});

describe('findTruncationCandidates — 확신도', () => {
    it('실제로 거의 빈 카드일 수 있는 잔액은 확신도를 낮게 매긴다', () => {
        const [found] = findTruncationCandidates('hipassCards', { balance: 50 });
        expect(found.confidence).toBe('low');
    });

    it('갓 출고된 차량일 수 있는 누적 km도 확신도를 낮게 매긴다', () => {
        const [found] = findTruncationCandidates('vehicles', { currentKm: 8 });
        expect(found.confidence).toBe('low');
    });

    it('한 문서에 잘린 필드가 여럿이면 모두 돌려준다', () => {
        const found = findTruncationCandidates('maintenanceRecords', { cost: 5, km: 4, nextDueKm: 5 });
        expect(found.map((f) => f.field).sort()).toEqual(['cost', 'km', 'nextDueKm']);
    });
});

describe('fuelUnitPrice', () => {
    it('주유량이 0이거나 값이 없으면 판단하지 않는다 (0으로 나누지 않는다)', () => {
        expect(fuelUnitPrice(60000, 0)).toBeNull();
        expect(fuelUnitPrice(60000, undefined)).toBeNull();
        expect(fuelUnitPrice(undefined, 40)).toBeNull();
        expect(fuelUnitPrice(60000, NaN)).toBeNull();
    });

    it('정상 주유의 단가를 계산한다', () => {
        expect(fuelUnitPrice(60000, 40)).toBe(1500);
    });
});

describe('점검 범위', () => {
    it('#370에서 고친 필드만 본다 — 목록이 조용히 늘거나 줄면 실패한다', () => {
        expect(AUDITED_COLLECTIONS.sort()).toEqual(
            ['fuelLogs', 'hipassCards', 'hipassCharges', 'maintenanceRecords', 'vehicles'].sort(),
        );
        expect(floorRulesFor('fuelLogs').map((r) => r.field).sort()).toEqual(['fuelCost', 'meterReading']);
        expect(floorRulesFor('maintenanceRecords').map((r) => r.field).sort()).toEqual(['cost', 'km', 'nextDueKm']);
    });

    it('운행일지는 점검 대상이 아니다 — startKm·endKm은 처음부터 Number로 변환했다', () => {
        expect(AUDITED_COLLECTIONS).not.toContain('driveLogs');
        expect(floorRulesFor('driveLogs')).toEqual([]);
    });
});
