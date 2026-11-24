/**
 * updateAggregatedStats.test.ts — 운행일지 생성·수정·삭제 시 기관 통계 증분
 *
 * organizations/{orgId}/stats/aggregate 문서에 FieldValue.increment로 더하고 빼는 구조라,
 * 한 번 잘못 더한 값은 다음 전체 재집계 전까지 그대로 남는다. 그래서 증분의 부호·크기와
 * 월 키(KST)·월 이동 시의 이관, 그리고 "지난달 소급 표시(markStaleMonths)"가 항상 불리는지를 고정한다.
 * 로그 출력은 단언하지 않는다(로거 교체와 무관하게 유지).
 */
const mockSet = jest.fn();
const paths: string[] = [];

function docRef(path: string): Record<string, unknown> {
    return {
        collection: (c: string) => colRef(`${path}/${c}`),
        set: (data: unknown, opts: unknown) => { paths.push(path); return mockSet(data, opts); },
    };
}
function colRef(path: string) {
    return { doc: (id: string) => docRef(`${path}/${id}`) };
}

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ collection: (c: string) => colRef(c) }),
    FieldValue: {
        increment: (n: number) => ({ inc: n }),
        serverTimestamp: () => 'SERVER_TS',
    },
}));

const mockMarkStaleMonths = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/statistics/staleMonths', () => ({
    markStaleMonths: (...a: unknown[]) => mockMarkStaleMonths(...a),
}));

import {
    getMonthKey,
    calcDistance,
    handleStatsOnCreate,
    handleStatsOnUpdate,
    handleStatsOnDelete,
} from '../services/statistics/updateAggregatedStats';

/** Firestore Timestamp 흉내 — toDate()만 쓴다 */
const ts = (iso: string) => ({ toDate: () => new Date(iso) });
const inc = (n: number) => ({ inc: n });

describe('updateAggregatedStats', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        paths.length = 0;
        mockSet.mockResolvedValue(undefined);
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('getMonthKey', () => {
        it('데이터나 timestamp가 없으면 null이다', () => {
            expect(getMonthKey(undefined)).toBeNull();
            expect(getMonthKey({})).toBeNull();
            expect(getMonthKey({ timestamp: '2026-11-01' })).toBeNull();
        });

        it('Firestore Timestamp를 KST 월로 바꾼다 — UTC로는 전달 말일인 KST 1일 새벽', () => {
            expect(getMonthKey({ timestamp: ts('2026-10-31T15:30:00Z') })).toBe('2026-11');
            expect(getMonthKey({ timestamp: ts('2026-10-31T14:59:59Z') })).toBe('2026-10');
        });

        it('Date 객체도 받는다', () => {
            expect(getMonthKey({ timestamp: new Date('2026-12-31T15:00:00Z') })).toBe('2027-01');
        });
    });

    describe('calcDistance', () => {
        it('종료 - 시작 km를 돌려준다', () => {
            expect(calcDistance({ startKm: 1000, endKm: 1042 })).toBe(42);
        });

        it('음수·0·데이터 없음은 0이다', () => {
            expect(calcDistance({ startKm: 1042, endKm: 1000 })).toBe(0);
            expect(calcDistance({ startKm: 5, endKm: 5 })).toBe(0);
            expect(calcDistance(undefined)).toBe(0);
        });

        it('비어 있는 필드는 0으로 본다', () => {
            expect(calcDistance({ endKm: 30 })).toBe(30);
            expect(calcDistance({ startKm: 30 })).toBe(0);
        });
    });

    describe('handleStatsOnCreate', () => {
        it('해당 기관의 aggregate 문서에 건수·거리·월별 값을 merge로 더한다', async () => {
            await handleStatsOnCreate('org1', { startKm: 100, endKm: 150, timestamp: ts('2026-11-10T01:00:00Z') });

            expect(paths).toEqual(['organizations/org1/stats/aggregate']);
            expect(mockSet).toHaveBeenCalledWith({
                count: inc(1),
                totalDistance: inc(50),
                lastUpdatedAt: 'SERVER_TS',
                monthlyStats: { '2026-11': { count: inc(1), totalDistance: inc(50) } },
            }, { merge: true });
            expect(mockMarkStaleMonths).toHaveBeenCalledWith('org1', ['2026-11']);
        });

        it('timestamp가 없으면 월별 값 없이 전체만 더한다', async () => {
            await handleStatsOnCreate('org1', { startKm: 0, endKm: 10 });

            const payload = mockSet.mock.calls[0][0];
            expect(payload).not.toHaveProperty('monthlyStats');
            expect(payload.count).toEqual(inc(1));
            expect(mockMarkStaleMonths).toHaveBeenCalledWith('org1', [null]);
        });

        it('저장이 실패해도 던지지 않고 소급 표시는 계속한다', async () => {
            mockSet.mockRejectedValue(new Error('DEADLINE_EXCEEDED'));

            await expect(handleStatsOnCreate('org1', { timestamp: ts('2026-05-01T00:00:00Z') })).resolves.toBeUndefined();
            expect(mockMarkStaleMonths).toHaveBeenCalledWith('org1', ['2026-05']);
        });
    });

    describe('handleStatsOnUpdate', () => {
        const nov = ts('2026-11-10T01:00:00Z');
        const oct = ts('2026-10-10T01:00:00Z');

        it('거리·월이 그대로면 쓰지 않지만 소급 표시는 한다 — 운전자·시각만 바뀌어도 분석 숫자는 달라진다', async () => {
            await handleStatsOnUpdate('org1',
                { startKm: 0, endKm: 10, timestamp: nov, driverName: 'A' },
                { startKm: 0, endKm: 10, timestamp: nov, driverName: 'B' });

            expect(mockSet).not.toHaveBeenCalled();
            expect(mockMarkStaleMonths).toHaveBeenCalledWith('org1', ['2026-11', '2026-11']);
        });

        it('같은 달에서 거리만 바뀌면 차이만큼 전체·월별 거리를 고친다 (건수는 그대로)', async () => {
            await handleStatsOnUpdate('org1',
                { startKm: 0, endKm: 10, timestamp: nov },
                { startKm: 0, endKm: 25, timestamp: nov });

            expect(paths).toEqual(['organizations/org1/stats/aggregate']);
            expect(mockSet).toHaveBeenCalledWith({
                totalDistance: inc(15),
                lastUpdatedAt: 'SERVER_TS',
                monthlyStats: { '2026-11': { totalDistance: inc(15) } },
            }, { merge: true });
        });

        it('거리가 줄면 음수로 뺀다', async () => {
            await handleStatsOnUpdate('org1',
                { startKm: 0, endKm: 40, timestamp: nov },
                { startKm: 0, endKm: 30, timestamp: nov });

            expect(mockSet.mock.calls[0][0].totalDistance).toEqual(inc(-10));
        });

        it('달이 바뀌면 옛 달에서 건수·거리를 빼고 새 달에 더한다', async () => {
            await handleStatsOnUpdate('org1',
                { startKm: 0, endKm: 10, timestamp: oct },
                { startKm: 0, endKm: 12, timestamp: nov });

            expect(mockSet).toHaveBeenCalledWith({
                totalDistance: inc(2),
                lastUpdatedAt: 'SERVER_TS',
                count: inc(0),
                monthlyStats: {
                    '2026-10': { count: inc(-1), totalDistance: inc(-10) },
                    '2026-11': { count: inc(1), totalDistance: inc(12) },
                },
            }, { merge: true });
            expect(mockMarkStaleMonths).toHaveBeenCalledWith('org1', ['2026-10', '2026-11']);
        });

        it('거리가 같아도 달이 바뀌면 이관한다', async () => {
            await handleStatsOnUpdate('org1',
                { startKm: 0, endKm: 10, timestamp: oct },
                { startKm: 0, endKm: 10, timestamp: nov });

            const payload = mockSet.mock.calls[0][0];
            expect(payload.totalDistance).toEqual(inc(0));
            expect(Object.keys(payload.monthlyStats)).toEqual(['2026-10', '2026-11']);
        });

        // 2026-11-24 수정: 한쪽에만 월이 있어도 버킷 이동으로 본다. 예전에는 둘 다 있을 때만 이동으로 봐서
        // 새로 월이 생긴 기록은 거리 차이만 더해지고 건수(+1)·기존 거리는 들어가지 않았다(월별 합 ≠ 전체).
        it('수정 전 월을 모르면 새 달에 건수·거리를 통째로 넣는다', async () => {
            await handleStatsOnUpdate('org1',
                { startKm: 0, endKm: 10 },
                { startKm: 0, endKm: 15, timestamp: nov });

            expect(mockSet.mock.calls[0][0]).toEqual({
                totalDistance: inc(5),
                lastUpdatedAt: 'SERVER_TS',
                count: inc(0),
                monthlyStats: { '2026-11': { count: inc(1), totalDistance: inc(15) } },
            });
        });

        it('수정 후 월을 모르면 옛 달에서 건수·거리를 뺀다', async () => {
            await handleStatsOnUpdate('org1',
                { startKm: 0, endKm: 10, timestamp: nov },
                { startKm: 0, endKm: 15 });

            expect(mockSet.mock.calls[0][0]).toEqual({
                totalDistance: inc(5),
                lastUpdatedAt: 'SERVER_TS',
                count: inc(0),
                monthlyStats: { '2026-11': { count: inc(-1), totalDistance: inc(-10) } },
            });
        });

        it('양쪽 모두 월을 모르면 월별 값은 건드리지 않는다', async () => {
            await handleStatsOnUpdate('org1',
                { startKm: 0, endKm: 10 },
                { startKm: 0, endKm: 15 });

            expect(mockSet.mock.calls[0][0]).not.toHaveProperty('monthlyStats');
            expect(mockSet.mock.calls[0][0].totalDistance).toEqual(inc(5));
        });

        it('저장이 실패해도 던지지 않는다', async () => {
            mockSet.mockRejectedValue(new Error('UNAVAILABLE'));

            await expect(handleStatsOnUpdate('org1',
                { startKm: 0, endKm: 1, timestamp: nov },
                { startKm: 0, endKm: 2, timestamp: nov })).resolves.toBeUndefined();
        });
    });

    describe('handleStatsOnDelete', () => {
        it('건수·거리·월별 값을 뺀다', async () => {
            await handleStatsOnDelete('org2', { startKm: 10, endKm: 30, timestamp: ts('2026-03-05T00:00:00Z') });

            expect(paths).toEqual(['organizations/org2/stats/aggregate']);
            expect(mockSet).toHaveBeenCalledWith({
                count: inc(-1),
                totalDistance: inc(-20),
                lastUpdatedAt: 'SERVER_TS',
                monthlyStats: { '2026-03': { count: inc(-1), totalDistance: inc(-20) } },
            }, { merge: true });
            expect(mockMarkStaleMonths).toHaveBeenCalledWith('org2', ['2026-03']);
        });

        it('timestamp가 없으면 전체만 뺀다', async () => {
            await handleStatsOnDelete('org2', { startKm: 10, endKm: 30 });

            expect(mockSet.mock.calls[0][0]).not.toHaveProperty('monthlyStats');
        });

        it('거리가 음수였던 기록은 0을 뺀다', async () => {
            await handleStatsOnDelete('org2', { startKm: 30, endKm: 10 });

            expect(mockSet.mock.calls[0][0].totalDistance).toEqual(inc(-0));
        });

        it('저장이 실패해도 던지지 않고 소급 표시는 계속한다', async () => {
            mockSet.mockRejectedValue(new Error('UNAVAILABLE'));

            await expect(handleStatsOnDelete('org2', { timestamp: ts('2026-01-15T00:00:00Z') })).resolves.toBeUndefined();
            expect(mockMarkStaleMonths).toHaveBeenCalledWith('org2', ['2026-01']);
        });
    });
});
