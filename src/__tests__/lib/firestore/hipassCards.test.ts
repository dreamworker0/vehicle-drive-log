/**
 * firestore/hipass 도메인 함수 단위 테스트 — **검산 기준점**과 행위자 스탬프
 *
 * 잔액은 서버 트리거가 증분으로 굴린다(Phase 227). 증분 회계는 한 번 어긋나면 스스로
 * 복구되지 않으므로, 밖에서 "지금 잔액이 맞는가"를 물을 수 있어야 한다. 그 물음은
 * `balanceBaseline`/`baselineAt`이 있어야 성립하고, 기준점은 **그 시점의 값이라 지나가면
 * 복원할 수 없다.** 여기서 고정하는 것은 그 기준점이 제때 박히는가다.
 *
 *  (1) 카드를 만들 때 등록 시점 잔액이 기준점이 된다
 *  (2) 사람이 잔액을 손으로 고치면 **그 값이 새 기준점**이 된다 — 실물을 보고 맞춘 것이므로
 *      그때부터 다시 세는 것이 옳다. 다시 세지 않으면 이후 모든 대조가 그 정정만큼
 *      어긋난 채 남아 검산이 무의미해진다
 *  (3) 잔액을 건드리지 않는 수정(메모 등)은 기준점을 밀지 않는다 — 밀면 그 사이의
 *      누적 증분이 통째로 '검산 완료' 처리되어 오차가 묻힌다
 *  (4) 잔액을 바꾸는 쓰기에는 행위자 스탬프가 실린다(Rules가 요구한다)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const makeRef = (label: string) => {
    const ref: { label: string; withConverter: (...a: unknown[]) => unknown } = {
        label,
        withConverter: () => ref,
    };
    return ref;
};

vi.mock('firebase/firestore', () => ({
    collection: vi.fn((_db: unknown, ...path: string[]) => makeRef(`col:${path.join('/')}`)),
    doc: vi.fn((_db: unknown, ...path: string[]) => makeRef(`doc:${path.join('/')}`)),
    query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ _type: 'where', field, op, value })),
    getDocs: vi.fn(async () => ({ docs: [] })),
    addDoc: vi.fn(async () => ({ id: 'new-card' })),
    updateDoc: vi.fn(async () => undefined),
    deleteDoc: vi.fn(async () => undefined),
    serverTimestamp: vi.fn(() => '__serverTimestamp__'),
}));

vi.mock('../../../lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'admin-1' } } }));
vi.mock('../../../lib/sentry', () => ({ captureError: vi.fn() }));

import { addDoc, updateDoc } from 'firebase/firestore';
import { createHipassCard, updateHipassCard } from '../../../lib/firestore/hipass';

beforeEach(() => {
    vi.clearAllMocks();
});

/** updateDoc에 실린 패치 본문 */
const lastPatch = () => (updateDoc as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as Record<string, unknown>;

describe('createHipassCard — 등록 시점이 기준점', () => {
    it('잔액과 같은 값으로 기준점을 박는다', async () => {
        await createHipassCard({ organizationId: 'org-A', cardNumber: '1111', vehicleId: 'v1', balance: 50000 });

        const payload = (addDoc as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as Record<string, unknown>;
        expect(payload.balance).toBe(50000);
        expect(payload.balanceBaseline).toBe(50000);
        expect(payload.baselineAt).toBe('__serverTimestamp__');
    });

    it('잔액을 안 주면 0이 기준점이 된다', async () => {
        await createHipassCard({ organizationId: 'org-A', cardNumber: '1111', vehicleId: 'v1' });

        const payload = (addDoc as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as Record<string, unknown>;
        expect(payload.balance).toBe(0);
        expect(payload.balanceBaseline).toBe(0);
    });
});

describe('updateHipassCard — 손으로 고친 잔액이 새 기준점', () => {
    it('잔액을 바꾸면 기준점도 그 값으로 다시 선다', async () => {
        await updateHipassCard('c1', { balance: 32000, memo: '실물 확인' });

        const patch = lastPatch();
        expect(patch.balance).toBe(32000);
        expect(patch.balanceBaseline).toBe(32000);
        expect(patch.baselineAt).toBe('__serverTimestamp__');
    });

    it('잔액을 바꾸는 쓰기에는 행위자 스탬프가 실린다', async () => {
        // Rules가 요구한다 — 없으면 permission-denied가 되어 수동 정정이 통째로 막힌다.
        await updateHipassCard('c1', { balance: 32000 });
        expect(lastPatch().lastEditedByUid).toBe('admin-1');
    });

    it('잔액을 건드리지 않는 수정은 기준점을 밀지 않는다', async () => {
        // 밀면 그 사이의 누적 증분이 통째로 '검산 완료'가 되어 오차가 묻힌다.
        await updateHipassCard('c1', { memo: '차량 교체' });

        const patch = lastPatch();
        expect(patch).not.toHaveProperty('balanceBaseline');
        expect(patch).not.toHaveProperty('baselineAt');
        expect(patch.memo).toBe('차량 교체');
    });

    it('잔액을 0으로 맞추는 정정도 기준점이 된다', async () => {
        // `0`은 falsy라 `data.balance ? …` 같은 판정을 쓰면 조용히 빠진다.
        await updateHipassCard('c1', { balance: 0 });
        expect(lastPatch().balanceBaseline).toBe(0);
    });
});
