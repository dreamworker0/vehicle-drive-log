/**
 * syncHipassBalance.test — 하이패스 잔액의 서버 권위 반영
 *
 * 잔액은 원래 클라이언트가 계산해 절대값으로 덮어썼다(쓰기 경로 넷, 그중 셋이 오래된 값
 * 기준의 read-modify-write). 그래서 동시 작업이 유실됐고, 기관 구성원 누구나 기록 없이
 * 임의 값을 넣을 수 있었다. 주인을 서버로 옮기면서 여기서 지켜야 할 것이 넷이 된다.
 *   (1) 기록의 변화가 **한 번만, 차액만큼** 반영된다
 *   (2) 잔액이 0 아래로 내려가지 않는다 — Rules와 화면이 모두 `>= 0`을 전제하는데
 *       Admin SDK는 Rules를 우회하므로 여기서 막지 않으면 막을 곳이 없다
 *   (3) 남의 기관 카드를 건드리지 않는다
 *   (4) 판단이 서지 않으면(카드 없음·중복 연결) **깎지 않는다** — 잘못 깎는 것보다 낫다
 */

/** 카드 저장소 — 테스트마다 초기화한다 */
let cards: Record<string, Record<string, unknown> | undefined> = {};
/** 기관+차량 조회가 돌려줄 카드 ID 목록 */
let vehicleCardIds: string[] = [];
/** 트랜잭션 실행 횟수 — "아무것도 쓰지 않았다"를 증명하는 데 쓴다 */
let transactionCount = 0;

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        runTransaction: async (fn: (tx: any) => Promise<any>) => {
            transactionCount += 1;
            const tx = {
                get: async (ref: { __id: string }) => ({
                    exists: cards[ref.__id] !== undefined,
                    data: () => cards[ref.__id],
                }),
                update: (ref: { __id: string }, patch: Record<string, unknown>) => {
                    cards[ref.__id] = { ...cards[ref.__id], ...patch };
                },
            };
            return fn(tx);
        },
        collection: (name: string) => {
            if (name !== 'hipassCards') throw new Error(`예상하지 못한 컬렉션 접근: ${name}`);
            const query: any = {
                doc: (id: string) => ({ __id: id }),
                where: () => query,
                limit: () => query,
                get: async () => ({
                    empty: vehicleCardIds.length === 0,
                    size: vehicleCardIds.length,
                    docs: vehicleCardIds.map((id) => ({ id })),
                }),
            };
            return query;
        },
    }),
    FieldValue: { increment: (n: number) => ({ __increment: n }) },
}));

jest.mock('../core/sentry', () => ({ captureError: jest.fn() }));

import {
    applyBalanceDelta, usedAmountOf, findCardIdForVehicle, applyDriveLogHipassDelta,
} from '../services/hipass/applyBalanceDelta';

beforeEach(() => {
    cards = { c1: { organizationId: 'org-A', balance: 10_000 } };
    vehicleCardIds = ['c1'];
    transactionCount = 0;
});

describe('applyBalanceDelta', () => {
    it('차액만큼 더한다', async () => {
        const out = await applyBalanceDelta('t', 'c1', 'org-A', 5_000);
        expect(out).toEqual({ applied: true, before: 10_000, after: 15_000 });
        expect(cards.c1?.balance).toBe(15_000);
    });

    it('음수 delta는 뺀다', async () => {
        await applyBalanceDelta('t', 'c1', 'org-A', -3_000);
        expect(cards.c1?.balance).toBe(7_000);
    });

    it('0 아래로는 내려가지 않는다', async () => {
        await applyBalanceDelta('t', 'c1', 'org-A', -30_000);
        expect(cards.c1?.balance).toBe(0);
    });

    it('delta가 0이면 트랜잭션조차 열지 않는다', async () => {
        const out = await applyBalanceDelta('t', 'c1', 'org-A', 0);
        expect(out).toEqual({ applied: false, reason: 'no-delta' });
        expect(transactionCount).toBe(0);
    });

    it('다른 기관의 카드는 건드리지 않는다', async () => {
        const out = await applyBalanceDelta('t', 'c1', 'org-B', 5_000);
        expect(out).toEqual({ applied: false, reason: 'org-mismatch' });
        expect(cards.c1?.balance).toBe(10_000);
    });

    it('카드가 이미 지워졌으면 조용히 넘어간다', async () => {
        const out = await applyBalanceDelta('t', 'gone', 'org-A', 5_000);
        expect(out).toEqual({ applied: false, reason: 'card-missing' });
    });

    it('잔액 필드가 없던 카드는 0에서 시작한다', async () => {
        cards.c2 = { organizationId: 'org-A' };
        await applyBalanceDelta('t', 'c2', 'org-A', 4_000);
        expect(cards.c2?.balance).toBe(4_000);
    });

    it('카드 ID나 기관이 없으면 아무것도 하지 않는다', async () => {
        expect(await applyBalanceDelta('t', undefined, 'org-A', 1)).toEqual({ applied: false, reason: 'no-card' });
        expect(await applyBalanceDelta('t', 'c1', undefined, 1)).toEqual({ applied: false, reason: 'no-card' });
        expect(transactionCount).toBe(0);
    });
});

describe('usedAmountOf', () => {
    it('사용 전 - 사용 후', () => {
        expect(usedAmountOf({ hipassBalanceBefore: 10_000, hipassBalanceAfter: 9_500 })).toBe(500);
    });

    it('한쪽만 있으면 0 — 없는 값을 0으로 보면 잔액을 통째로 깎는다', () => {
        expect(usedAmountOf({ hipassBalanceBefore: 10_000 })).toBe(0);
        expect(usedAmountOf({ hipassBalanceAfter: 9_500 })).toBe(0);
        expect(usedAmountOf({})).toBe(0);
        expect(usedAmountOf(undefined)).toBe(0);
    });

    it('숫자가 아니면 0', () => {
        expect(usedAmountOf({ hipassBalanceBefore: '10000', hipassBalanceAfter: 9_500 })).toBe(0);
    });
});

describe('findCardIdForVehicle', () => {
    it('기관+차량으로 카드를 찾는다 (화면이 카드를 고르는 규칙과 같다)', async () => {
        expect(await findCardIdForVehicle('t', 'org-A', 'v1')).toBe('c1');
    });

    it('카드가 없으면 null', async () => {
        vehicleCardIds = [];
        expect(await findCardIdForVehicle('t', 'org-A', 'v1')).toBeNull();
    });

    it('한 차량에 카드가 둘이면 고르지 않는다 — 잘못 깎는 것보다 안 깎는 쪽이 낫다', async () => {
        vehicleCardIds = ['c1', 'c2'];
        expect(await findCardIdForVehicle('t', 'org-A', 'v1')).toBeNull();
    });

    it('기관이나 차량이 없으면 null', async () => {
        expect(await findCardIdForVehicle('t', undefined, 'v1')).toBeNull();
        expect(await findCardIdForVehicle('t', 'org-A', undefined)).toBeNull();
    });
});

describe('applyDriveLogHipassDelta', () => {
    it('사용액이 늘면 잔액은 그만큼 줄어든다', async () => {
        await applyDriveLogHipassDelta('t', 'org-A', 'v1', 500);
        expect(cards.c1?.balance).toBe(9_500);
    });

    it('삭제(사용액 되돌리기)는 잔액을 되돌린다', async () => {
        await applyDriveLogHipassDelta('t', 'org-A', 'v1', -500);
        expect(cards.c1?.balance).toBe(10_500);
    });

    it('사용액 변화가 없으면 카드를 찾지도 않는다', async () => {
        await applyDriveLogHipassDelta('t', 'org-A', 'v1', 0);
        expect(cards.c1?.balance).toBe(10_000);
        expect(transactionCount).toBe(0);
    });

    it('카드가 중복 연결된 차량은 잔액을 건드리지 않는다', async () => {
        vehicleCardIds = ['c1', 'c2'];
        await applyDriveLogHipassDelta('t', 'org-A', 'v1', 500);
        expect(cards.c1?.balance).toBe(10_000);
        expect(transactionCount).toBe(0);
    });
});
