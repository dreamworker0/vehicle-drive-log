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
 *   (5) 같은 이벤트가 두 번 와도(Eventarc at-least-once) **한 번만** 반영된다 — 처리 표시
 */

/** 카드 저장소 — 테스트마다 초기화한다 */
let cards: Record<string, Record<string, unknown> | undefined> = {};
/** 기관+차량 조회가 돌려줄 카드 ID 목록 */
let vehicleCardIds: string[] = [];
/** 트랜잭션 실행 횟수 — "아무것도 쓰지 않았다"를 증명하는 데 쓴다 */
let transactionCount = 0;
/** 마지막 카드 조회에 실린 where 절 — 테넌트 필터 회귀 방어 */
let lastQueryFilters: Array<[string, string, unknown]> = [];
/** 켜면 카드 조회가 던진다 — 일시적 UNAVAILABLE 재현 */
let queryThrows = false;
/** 켜면 트랜잭션이 던진다 — 쓰기 실패 재현 */
let transactionThrows = false;
/** 처리 표시 저장소(hipassBalanceEvents) */
let marks: Record<string, Record<string, unknown>> = {};

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        runTransaction: async (fn: (tx: any) => Promise<any>) => {
            transactionCount += 1;
            if (transactionThrows) throw new Error('UNAVAILABLE');
            // 실제 트랜잭션처럼 쓰기는 콜백이 끝난 뒤 한꺼번에 반영한다.
            const pending: Array<() => void> = [];
            const tx = {
                get: async (ref: { __col: string; __id: string }) => {
                    const store = ref.__col === 'hipassBalanceEvents' ? marks : cards;
                    return { exists: store[ref.__id] !== undefined, data: () => store[ref.__id] };
                },
                update: (ref: { __id: string }, patch: Record<string, unknown>) => {
                    pending.push(() => { cards[ref.__id] = { ...cards[ref.__id], ...patch }; });
                },
                set: (ref: { __col: string; __id: string }, data: Record<string, unknown>) => {
                    if (ref.__col !== 'hipassBalanceEvents') throw new Error(`예상하지 못한 set: ${ref.__col}`);
                    pending.push(() => { marks[ref.__id] = data; });
                },
            };
            const result = await fn(tx);
            pending.forEach((apply) => apply());
            return result;
        },
        collection: (name: string) => {
            if (name === 'hipassBalanceEvents') return { doc: (id: string) => ({ __col: name, __id: id }) };
            if (name !== 'hipassCards') throw new Error(`예상하지 못한 컬렉션 접근: ${name}`);
            // where 인자를 **버리지 않고 기록한다.** 인자를 무시하는 가짜였을 때는
            // `.where("organizationId", ...)`를 지워도 테스트가 전부 통과했다 —
            // 멀티테넌트 필터(CLAUDE.md 절대규칙 #1)를 지키는 장치가 하나도 없던 셈이다.
            // 커스텀 ESLint 규칙은 src/lib/firestore/ 전용이라 functions/를 덮지 않는다.
            const filters: Array<[string, string, unknown]> = [];
            const query: any = {
                doc: (id: string) => ({ __col: name, __id: id }),
                where: (field: string, op: string, value: unknown) => { filters.push([field, op, value]); return query; },
                limit: () => query,
                get: async () => {
                    if (queryThrows) throw new Error('DEADLINE_EXCEEDED');
                    lastQueryFilters = filters;
                    return {
                        empty: vehicleCardIds.length === 0,
                        size: vehicleCardIds.length,
                        docs: vehicleCardIds.map((id) => ({ id })),
                    };
                },
            };
            return query;
        },
    }),
    FieldValue: { increment: (n: number) => ({ __increment: n }) },
}));

jest.mock('../core/sentry', () => ({ captureError: jest.fn() }));
// 해지 기관 가드는 orgRetirement.test.ts가 따로 검증한다 — 여기서는 정상 기관으로 고정한다.
const mockIsOrgRetired = jest.fn(async (_orgId: unknown) => false);
jest.mock('../utils/orgRetirement', () => ({ isOrgRetired: (orgId: unknown) => mockIsOrgRetired(orgId) }));

// 트리거 래퍼는 핸들러를 그대로 반환한다(syncDriveLogKm.test와 같은 방식) —
// 진짜 래퍼를 쓰면 CloudEvent 모양을 온전히 만들어야 해서 검사 대상이 흐려진다.
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_o: unknown, h: unknown) => h,
    onDocumentUpdated: (_o: unknown, h: unknown) => h,
    onDocumentDeleted: (_o: unknown, h: unknown) => h,
}));

import {
    applyBalanceDelta, usedAmountOf, findCardIdForVehicle, applyDriveLogHipassDelta, hipassFieldsDropped,
    eventDedupeKey, EVENT_MARK_TTL_DAYS,
} from '../services/hipass/applyBalanceDelta';
import {
    onHipassChargeCreated, onHipassChargeUpdated, onHipassChargeDeleted,
} from '../handlers/triggers/syncHipassBalance';

/** 트리거 핸들러를 이벤트 모양으로 호출한다 — 같은 eventId로 다시 부르면 재전달이다 */
const created = (data: Record<string, unknown>, eventId = 'evt-1') =>
    (onHipassChargeCreated as unknown as (e: unknown) => Promise<void>)({
        id: eventId, data: { data: () => data }, params: { chargeId: 'h1' },
    });
const deleted = (data: Record<string, unknown>, eventId = 'evt-1') =>
    (onHipassChargeDeleted as unknown as (e: unknown) => Promise<void>)({
        id: eventId, data: { data: () => data }, params: { chargeId: 'h1' },
    });
const updated = (before: Record<string, unknown>, after: Record<string, unknown>, eventId = 'evt-1') =>
    (onHipassChargeUpdated as unknown as (e: unknown) => Promise<void>)({
        id: eventId,
        data: { before: { data: () => before }, after: { data: () => after } },
        params: { chargeId: 'h1' },
    });

beforeEach(() => {
    cards = { c1: { organizationId: 'org-A', balance: 10_000 } };
    vehicleCardIds = ['c1'];
    transactionCount = 0;
    lastQueryFilters = [];
    queryThrows = false;
    transactionThrows = false;
    marks = {};
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

    it('음수 사용액은 0으로 본다 — 한 건으로 잔액을 불릴 수 없다', () => {
        // 통행료를 쓰고 잔액이 늘 수는 없다. Rules가 먼저 막지만, Admin SDK 경로와 옛 기록이
        // 있어 여기서도 끊는다. 막지 않으면 운행일지 한 건이 곧 임의 충전이 된다.
        expect(usedAmountOf({ hipassBalanceBefore: 0, hipassBalanceAfter: 1_000_000 })).toBe(0);
    });
});

describe('hipassFieldsDropped', () => {
    // 결정론적 ID로 같은 운행을 다시 저장할 때(setDoc, merge 아님) 하이패스 필드가 통째로
    // 빠질 수 있다. usedAmountOf만으로는 '0원 사용'과 구분되지 않아 실제로 쓴 돈이 환불됐다.
    it('있다가 없어지면 참', () => {
        expect(hipassFieldsDropped(
            { hipassBalanceBefore: 10_000, hipassBalanceAfter: 9_500 }, { startKm: 1 },
        )).toBe(true);
    });

    it('둘 다 있거나 둘 다 없으면 거짓', () => {
        expect(hipassFieldsDropped(
            { hipassBalanceBefore: 10_000, hipassBalanceAfter: 9_500 },
            { hipassBalanceBefore: 10_000, hipassBalanceAfter: 9_000 },
        )).toBe(false);
        expect(hipassFieldsDropped({ startKm: 1 }, { startKm: 2 })).toBe(false);
    });

    it('없다가 생기는 것은 거짓(정상 입력)', () => {
        expect(hipassFieldsDropped({ startKm: 1 }, { hipassBalanceBefore: 10_000, hipassBalanceAfter: 9_500 })).toBe(false);
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

describe('findCardIdForVehicle — 테넌트 필터', () => {
    it('기관과 차량을 모두 where 절로 건다', async () => {
        await findCardIdForVehicle('t', 'org-A', 'v1');
        expect(lastQueryFilters).toEqual([
            ['organizationId', '==', 'org-A'],
            ['vehicleId', '==', 'v1'],
        ]);
    });
});

describe('충전 기록 트리거', () => {
    const charge = (over: Record<string, unknown> = {}) => ({
        organizationId: 'org-A', cardId: 'c1', chargeAmount: 5_000, ...over,
    });

    it('생성하면 그만큼 는다', async () => {
        await created(charge());
        expect(cards.c1?.balance).toBe(15_000);
    });

    it('삭제하면 그만큼 준다', async () => {
        await deleted(charge());
        expect(cards.c1?.balance).toBe(5_000);
    });

    it('해지된 기관의 파기로 지워지면 잔액을 되돌리지 않는다', async () => {
        mockIsOrgRetired.mockResolvedValueOnce(true);
        await deleted(charge());
        expect(cards.c1?.balance).toBe(10_000);
        expect(transactionCount).toBe(0);
    });

    it('수정하면 차액만 반영한다', async () => {
        await updated(charge(), charge({ chargeAmount: 8_000 }));
        expect(cards.c1?.balance).toBe(13_000);
    });

    it('금액이 그대로면 아무것도 쓰지 않는다', async () => {
        await updated(charge(), charge({ date: '2026-09-02' }));
        expect(cards.c1?.balance).toBe(10_000);
        expect(transactionCount).toBe(0);
    });

    it('카드를 옮긴 정정은 옛 카드에서 빼고 새 카드에 더한다', async () => {
        // 차액만 반영하면 두 카드가 동시에 어긋난다.
        cards.c2 = { organizationId: 'org-A', balance: 1_000 };
        await updated(charge(), charge({ cardId: 'c2', chargeAmount: 8_000 }));
        expect(cards.c1?.balance).toBe(5_000);   // 10,000 - 5,000(옛 금액)
        expect(cards.c2?.balance).toBe(9_000);   // 1,000 + 8,000(새 금액)
    });

    it('금액이 숫자가 아니면 0으로 보고 잔액을 건드리지 않는다', async () => {
        await created(charge({ chargeAmount: '5000' }));
        expect(cards.c1?.balance).toBe(10_000);
    });

    it('다른 기관의 카드를 가리키는 기록은 반영하지 않는다', async () => {
        await created(charge({ organizationId: 'org-B' }));
        expect(cards.c1?.balance).toBe(10_000);
    });

    it('문서가 비어 있으면 조용히 끝난다', async () => {
        await (onHipassChargeCreated as unknown as (e: unknown) => Promise<void>)({
            data: undefined, params: { chargeId: 'h1' },
        });
        expect(transactionCount).toBe(0);
    });
});

describe('중복 반영 방지 — 처리 표시', () => {
    // Eventarc 전달은 at-least-once다. retry: false여도 성공한 이벤트가 드물게 다시 온다.
    // 증분 반영은 두 번 오면 두 번 더해지므로, 이벤트 ID로 처리 표시를 남겨 두 번째를 건너뛴다.

    it('같은 키로 두 번 반영하면 두 번째는 건너뛴다', async () => {
        expect(await applyBalanceDelta('t', 'c1', 'org-A', 5_000, 'evt-1_delta')).toMatchObject({ applied: true });
        expect(await applyBalanceDelta('t', 'c1', 'org-A', 5_000, 'evt-1_delta'))
            .toEqual({ applied: false, reason: 'duplicate' });
        expect(cards.c1?.balance).toBe(15_000);
    });

    it('키가 다르면 각각 반영한다', async () => {
        await applyBalanceDelta('t', 'c1', 'org-A', 5_000, 'evt-1_delta');
        await applyBalanceDelta('t', 'c1', 'org-A', 5_000, 'evt-2_delta');
        expect(cards.c1?.balance).toBe(20_000);
    });

    it('키가 없으면 표시 없이 반영한다(종전 동작)', async () => {
        await applyBalanceDelta('t', 'c1', 'org-A', 5_000);
        await applyBalanceDelta('t', 'c1', 'org-A', 5_000);
        expect(cards.c1?.balance).toBe(20_000);
        expect(marks).toEqual({});
    });

    it(`표시는 잔액과 함께 남고 ${EVENT_MARK_TTL_DAYS}일 뒤 만료된다`, async () => {
        const before = Date.now();
        await applyBalanceDelta('onHipassChargeCreated', 'c1', 'org-A', 5_000, 'evt-1_delta');
        const mark = marks['evt-1_delta'];
        expect(mark).toMatchObject({ context: 'onHipassChargeCreated', cardId: 'c1', organizationId: 'org-A', delta: 5_000 });
        const ttlMs = (mark.expiresAt as Date).getTime() - before;
        expect(ttlMs).toBeGreaterThanOrEqual(EVENT_MARK_TTL_DAYS * 86_400_000);
        expect(ttlMs).toBeLessThan(EVENT_MARK_TTL_DAYS * 86_400_000 + 60_000);
    });

    it('반영하지 않은 경우(기관 불일치·카드 없음)는 표시를 남기지 않는다', async () => {
        await applyBalanceDelta('t', 'c1', 'org-B', 5_000, 'evt-1_delta');
        await applyBalanceDelta('t', 'gone', 'org-A', 5_000, 'evt-2_delta');
        expect(marks).toEqual({});
    });

    it('충전 기록 생성 이벤트가 두 번 와도 한 번만 는다', async () => {
        const c = { organizationId: 'org-A', cardId: 'c1', chargeAmount: 5_000 };
        await created(c);
        await created(c);
        expect(cards.c1?.balance).toBe(15_000);
    });

    it('충전 기록 삭제 이벤트가 두 번 와도 한 번만 준다', async () => {
        const c = { organizationId: 'org-A', cardId: 'c1', chargeAmount: 5_000 };
        await deleted(c);
        await deleted(c);
        expect(cards.c1?.balance).toBe(5_000);
    });

    it('카드를 옮긴 정정은 옛 카드·새 카드가 각자 한 번씩만 반영된다', async () => {
        // 한 이벤트가 카드 둘을 건드린다 — 키가 같으면 새 카드 반영이 "중복"으로 잘린다.
        cards.c2 = { organizationId: 'org-A', balance: 1_000 };
        const b = { organizationId: 'org-A', cardId: 'c1', chargeAmount: 5_000 };
        const a = { organizationId: 'org-A', cardId: 'c2', chargeAmount: 8_000 };
        await updated(b, a);
        await updated(b, a);
        expect(cards.c1?.balance).toBe(5_000);
        expect(cards.c2?.balance).toBe(9_000);
    });

    it('운행일지 사용액 반영도 같은 키면 한 번만 깎는다', async () => {
        await applyDriveLogHipassDelta('t', 'org-A', 'v1', 500, 'evt-1_delta');
        await applyDriveLogHipassDelta('t', 'org-A', 'v1', 500, 'evt-1_delta');
        expect(cards.c1?.balance).toBe(9_500);
    });

    it('표시 키 — 이벤트 ID가 없으면 만들지 않고, 문서 ID에 못 쓰는 / 는 바꾼다', () => {
        expect(eventDedupeKey(undefined, 'delta')).toBeUndefined();
        expect(eventDedupeKey('', 'delta')).toBeUndefined();
        expect(eventDedupeKey('a/b', 'old')).toBe('a_b_old');
    });
});

describe('실패해도 위로 던지지 않는다 — 회계 격리', () => {
    // 이 계약이 깨지면 운행일지 트리거의 바깥 catch까지 예외가 올라가고,
    // 그 뒤의 차량 누적 km 차분·startKm 연쇄 재정합·기관 통계가 **통째로 유실된다**
    // (retry: false라 이벤트 재전달도 없다). 같은 이유로 위치·주유 표시 갱신이
    // ...Safely로 격리돼 있다.
    //
    // **모킹하지 않은 실제 구현으로 검사한다.** 함수를 모킹한 채 reject시키면
    // 고쳐지기 전의 고장난 상태를 재현하면서도 초록이 된다.

    it('카드 조회가 던져도 삼킨다', async () => {
        queryThrows = true;
        await expect(applyDriveLogHipassDelta('t', 'org-A', 'v1', 500)).resolves.toBeUndefined();
    });

    it('트랜잭션이 던져도 삼킨다', async () => {
        transactionThrows = true;
        await expect(applyDriveLogHipassDelta('t', 'org-A', 'v1', 500)).resolves.toBeUndefined();
    });

    it('쓰기 실패는 write-failed로 보고한다 (카드 없음과 구분된다)', async () => {
        transactionThrows = true;
        await expect(applyBalanceDelta('t', 'c1', 'org-A', 5_000))
            .resolves.toEqual({ applied: false, reason: 'write-failed' });
    });
});
