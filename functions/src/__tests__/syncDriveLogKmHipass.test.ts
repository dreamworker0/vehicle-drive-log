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
 *  (4) 복원 스크립트가 아카이브를 되돌려도 오늘 잔액을 깎지 않는다.
 *
 * 하이패스 서비스는 모킹해 "무엇을 어떤 인자로 불렀는가"만 본다. 잔액 계산 자체와
 * "그 함수는 절대 던지지 않는다"는 계약은 모킹하지 않는 `syncHipassBalance.test`가 본다.
 */

const mockApplyDriveLogHipassDelta = jest.fn(async () => undefined);
const mockStatsOnCreate = jest.fn(async () => undefined);

jest.mock('../services/hipass/applyBalanceDelta', () => ({
    applyDriveLogHipassDelta: (...a: unknown[]) => mockApplyDriveLogHipassDelta(...(a as [])),
    // 순수 함수는 진짜를 쓴다 — 모킹하면 delta 계산과 필드 소실 판정이 검사에서 빠진다.
    // (여기서 빠뜨리면 undefined 호출이 던져지고 트리거의 바깥 catch가 삼켜,
    //  "호출 0회"로 조용히 실패한다. 실제로 그렇게 한 번 깨졌다.)
    usedAmountOf: jest.requireActual('../services/hipass/applyBalanceDelta').usedAmountOf,
    hipassFieldsDropped: jest.requireActual('../services/hipass/applyBalanceDelta').hipassFieldsDropped,
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
    handleStatsOnCreate: (...a: unknown[]) => mockStatsOnCreate(...(a as [])),
    handleStatsOnUpdate: jest.fn(async () => undefined),
    handleStatsOnDelete: jest.fn(async () => undefined),
}));
// 실제 반환은 **boolean**이다. 객체를 돌려주면 truthy라 `if (isConflict) return;`이 항상
// 참이 되어 모든 update 테스트가 충돌 검사 직후 조용히 조기 반환한다 — 지금은 하이패스
// 단언이 그보다 앞이라 결과가 맞지만, km·통계 단언을 추가하는 순간 실행되지 않는다.
jest.mock('../handlers/sync/conflictResolver', () => ({
    resolveDriveLogConflict: jest.fn(async () => false),
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
    mockStatsOnCreate.mockClear();
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

    // 격리(잔액 실패가 km 회계를 잃게 하지 않는다)는 **여기서 검사하지 않는다.**
    // 이 파일은 applyDriveLogHipassDelta를 통째로 모킹하므로, 그 함수를 reject시켜도
    // 실제 구현의 try/catch는 한 줄도 실행되지 않는다. 그렇게 쓴 테스트는 고쳐지기 전의
    // 고장난 상태(예외가 바깥 catch까지 올라가 km·통계가 유실되는 상태)를 재현하면서
    // 초록이 된다 — 계약을 지키는 척만 한다.
    // 진짜 계약("이 함수는 절대 던지지 않는다")은 모킹하지 않는 syncHipassBalance.test.ts에서 본다.

    it('하이패스 다음에 오는 회계(기관 통계)가 실제로 실행된다', async () => {
        // 하이패스 호출을 맨 앞에 둔 탓에 그 뒤 전부를 잃을 수 있었다. 그 뒤가 살아
        // 있다는 것을 한 군데라도 붙들어 둔다 — 이 단언이 없으면 "앞에 두었다"만 검사하고
        // "앞에 두어도 안전하다"는 검사하지 않는 셈이 된다.
        await call(onDriveLogCreated, { data: { data: () => log() }, params: { logId: 'd1' } });
        expect(mockStatsOnCreate).toHaveBeenCalled();
    });

    it('보존 기한 밖 기록의 생성(아카이브 복원)은 오늘 잔액을 깎지 않는다', async () => {
        // scripts/restoreArchivedLogs.ts가 batch.set으로 문서를 되살리면 이 트리거가 돈다.
        // 삭제 쪽 환불을 막은 것의 거울 — 막지 않으면 복원이 오늘 카드에서 옛 통행료를 뺀다.
        const old = new Date(driveLogRetentionCutoff().getTime() - 24 * 60 * 60 * 1000);
        await call(onDriveLogCreated, { data: { data: () => log({ timestamp: old }) }, params: { logId: 'd1' } });
        expect(mockApplyDriveLogHipassDelta).not.toHaveBeenCalled();
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

    it('기관이 바뀌면(superAdmin) 옛 기관 카드에서 빼고 새 기관 카드에 더한다', async () => {
        // 차량이 그대로여도 기관이 바뀌면 카드가 달라진다. else 분기로 가면 옛 기관 카드가
        // 그 금액을 계속 문 채 남는다.
        await call(onDriveLogUpdated, evt(log(), log({ organizationId: 'org-B' })));
        expect(mockApplyDriveLogHipassDelta).toHaveBeenNthCalledWith(1, 'onDriveLogUpdated', 'org-A', 'v1', -500);
        expect(mockApplyDriveLogHipassDelta).toHaveBeenNthCalledWith(2, 'onDriveLogUpdated', 'org-B', 'v1', 500);
    });

    it('하이패스 기록이 사라진 수정은 환불하지 않는다', async () => {
        // setDoc 덮어쓰기로 필드가 빠지면 usedAmountOf가 0이 되어 실제로 쓴 돈이 돌아왔다.
        await call(onDriveLogUpdated, evt(log(), { organizationId: 'org-A', vehicleId: 'v1', timestamp: new Date(), startKm: 100, endKm: 150 }));
        expect(mockApplyDriveLogHipassDelta).not.toHaveBeenCalled();
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
