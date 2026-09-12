/**
 * syncDriveLogKmHipass.test — 운행일지 트리거가 하이패스 잔액에 거는 조건
 *
 * 잔액 반영 자체는 `syncHipassBalance.test`가 본다. 여기서 고정하는 것은 **트리거가 그것을
 * 언제 부르고 무엇을 넘기는가**다. 실패하면 조용히 틀리는 것들이라 각각 이유가 있다.
 *
 *  (1) 어떤 조기 반환보다도 앞에서 불린다 — "마일리지 변경 없음" 분기 뒤에 두면
 *      하이패스만 고친 수정이 잔액에 영영 반영되지 않는다.
 *  (2) 보존 기한 정리(3년 지난 기록의 야간 아카이브)는 **환불하지 않는다** —
 *      거르지 않으면 3년 전에 쓴 통행료가 오늘 잔액으로 돌아온다.
 *  (3) 차량이 바뀐 수정은 옛 카드에서 빼고 새 카드에 더한다 — 차액만 반영하면
 *      두 카드가 동시에 어긋난다.
 *  (4) 잔액 반영이 실패해도 **km 회계를 함께 잃지 않는다**.
 *
 * 하이패스 서비스는 모킹해 "무엇을 어떤 인자로 불렀는가"만 본다. 트리거의 나머지 부분
 * (차량 조회·연쇄 재정합)은 여기 관심사가 아니며, 최소 모킹이라 도중에 던져도 트리거의
 * 바깥 catch가 삼킨다 — 그 사실이 (4)의 검사를 성립시킨다.
 */

const mockApplyDriveLogHipassDelta = jest.fn(async () => undefined);

jest.mock('../services/hipass/applyBalanceDelta', () => ({
    applyDriveLogHipassDelta: (...a: unknown[]) => mockApplyDriveLogHipassDelta(...(a as [])),
    // usedAmountOf는 순수 함수라 진짜를 쓴다 — 모킹하면 delta 계산이 검사에서 빠진다.
    usedAmountOf: jest.requireActual('../services/hipass/applyBalanceDelta').usedAmountOf,
}));

jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_o: unknown, h: unknown) => h,
    onDocumentUpdated: (_o: unknown, h: unknown) => h,
    onDocumentDeleted: (_o: unknown, h: unknown) => h,
}));

const mockVehicleUpdate = jest.fn(async () => undefined);
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: () => ({
            doc: () => ({
                get: async () => ({ exists: false, data: () => undefined }),
                update: mockVehicleUpdate,
            }),
            where: function () { return this; },
            orderBy: function () { return this; },
            limit: function () { return this; },
            get: async () => ({ empty: true, docs: [], size: 0 }),
        }),
        batch: () => ({ update: jest.fn(), delete: jest.fn(), commit: jest.fn(async () => undefined) }),
    }),
    FieldValue: {
        increment: (n: number) => ({ __increment: n }),
        serverTimestamp: () => 'SERVER_TS',
    },
}));

jest.mock('../services/statistics/updateAggregatedStats', () => ({
    handleStatsOnCreate: jest.fn(async () => undefined),
    handleStatsOnUpdate: jest.fn(async () => undefined),
    handleStatsOnDelete: jest.fn(async () => undefined),
}));
jest.mock('../handlers/sync/conflictResolver', () => ({
    resolveDriveLogConflict: jest.fn(async () => ({ resolved: false })),
}));
jest.mock('../core/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../utils/helpers', () => ({
    recordHeartbeat: jest.fn(async () => undefined),
    log: jest.fn(),
}));

import { onDriveLogCreated, onDriveLogUpdated, onDriveLogDeleted } from '../handlers/triggers/syncDriveLogKm';
import { driveLogRetentionCutoff } from '../utils/constants';

const call = (fn: unknown, event: unknown) => (fn as (e: unknown) => Promise<void>)(event);

/** 하이패스를 쓴 오늘자 운행일지 */
const log = (over: Record<string, unknown> = {}) => ({
    organizationId: 'org-A',
    vehicleId: 'v1',
    timestamp: new Date(),
    startKm: 100,
    endKm: 150,
    hipassBalanceBefore: 10_000,
    hipassBalanceAfter: 9_500,
    ...over,
});

beforeEach(() => {
    mockApplyDriveLogHipassDelta.mockClear();
    mockApplyDriveLogHipassDelta.mockImplementation(async () => undefined);
});

describe('onDriveLogCreated', () => {
    it('사용액만큼 잔액을 깎는다', async () => {
        await call(onDriveLogCreated, { data: { data: () => log() }, params: { logId: 'd1' } });
        expect(mockApplyDriveLogHipassDelta).toHaveBeenCalledWith('onDriveLogCreated', 'org-A', 'v1', 500);
    });

    it('하이패스를 쓰지 않은 운행은 부르되 0을 넘긴다(서비스가 즉시 반환한다)', async () => {
        await call(onDriveLogCreated, {
            data: { data: () => log({ hipassBalanceBefore: undefined, hipassBalanceAfter: undefined }) },
            params: { logId: 'd1' },
        });
        expect(mockApplyDriveLogHipassDelta).toHaveBeenCalledWith('onDriveLogCreated', 'org-A', 'v1', 0);
    });

    it('도착 km가 없어 조기 반환되는 기록에서도 하이패스는 반영된다', async () => {
        // 하이패스 호출이 km 가드 뒤에 있으면 이 검사가 깨진다.
        await call(onDriveLogCreated, { data: { data: () => log({ endKm: undefined }) }, params: { logId: 'd1' } });
        expect(mockApplyDriveLogHipassDelta).toHaveBeenCalledWith('onDriveLogCreated', 'org-A', 'v1', 500);
    });

    it('잔액 반영이 실패해도 트리거가 그 자리에서 죽지 않는다', async () => {
        mockApplyDriveLogHipassDelta.mockRejectedValueOnce(new Error('UNAVAILABLE') as never);
        await expect(
            call(onDriveLogCreated, { data: { data: () => log() }, params: { logId: 'd1' } }),
        ).resolves.toBeUndefined();
    });
});

describe('onDriveLogUpdated', () => {
    const evt = (before: Record<string, unknown>, after: Record<string, unknown>) => ({
        data: { before: { data: () => before }, after: { data: () => after } },
        params: { logId: 'd1' },
    });

    it('사용액 차액만 반영한다', async () => {
        await call(onDriveLogUpdated, evt(log(), log({ hipassBalanceAfter: 9_000 })));
        expect(mockApplyDriveLogHipassDelta).toHaveBeenCalledWith('onDriveLogUpdated', 'org-A', 'v1', 500);
    });

    it('하이패스가 그대로면 0을 넘긴다', async () => {
        await call(onDriveLogUpdated, evt(log(), log({ endKm: 160 })));
        expect(mockApplyDriveLogHipassDelta).toHaveBeenCalledWith('onDriveLogUpdated', 'org-A', 'v1', 0);
    });

    it('차량이 바뀌면 옛 카드에서 빼고 새 카드에 더한다', async () => {
        // Rules의 관리자 분기는 vehicleId를 얼리지 않는다 — 차액만 반영하면 두 카드가 어긋난다.
        await call(onDriveLogUpdated, evt(log(), log({ vehicleId: 'v2', hipassBalanceBefore: 8_000, hipassBalanceAfter: 7_000 })));
        expect(mockApplyDriveLogHipassDelta).toHaveBeenNthCalledWith(1, 'onDriveLogUpdated', 'org-A', 'v1', -500);
        expect(mockApplyDriveLogHipassDelta).toHaveBeenNthCalledWith(2, 'onDriveLogUpdated', 'org-A', 'v2', 1_000);
    });
});

describe('onDriveLogDeleted', () => {
    it('사용액을 되돌린다', async () => {
        await call(onDriveLogDeleted, { data: { data: () => log() }, params: { logId: 'd1' } });
        expect(mockApplyDriveLogHipassDelta).toHaveBeenCalledWith('onDriveLogDeleted', 'org-A', 'v1', -500);
    });

    it('보존 기한이 지난 기록의 정리는 환불하지 않는다', async () => {
        // 야간 배치가 3년 지난 기록을 500건씩 지운다. 거르지 않으면 밤마다 옛 통행료가
        // 오늘 잔액으로 돌아온다 — 조용히, 매일.
        const old = new Date(driveLogRetentionCutoff().getTime() - 24 * 60 * 60 * 1000);
        await call(onDriveLogDeleted, { data: { data: () => log({ timestamp: old }) }, params: { logId: 'd1' } });
        expect(mockApplyDriveLogHipassDelta).not.toHaveBeenCalled();
    });

    it('보존 기한 안쪽이면 그대로 되돌린다', async () => {
        const recent = new Date(driveLogRetentionCutoff().getTime() + 24 * 60 * 60 * 1000);
        await call(onDriveLogDeleted, { data: { data: () => log({ timestamp: recent }) }, params: { logId: 'd1' } });
        expect(mockApplyDriveLogHipassDelta).toHaveBeenCalledWith('onDriveLogDeleted', 'org-A', 'v1', -500);
    });
});
