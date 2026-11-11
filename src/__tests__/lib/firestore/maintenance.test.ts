/**
 * firestore/maintenance — 정비 차단·폐차 시 예약 일괄 취소(cancelVehicleReservations) 단위 테스트
 *
 * 예전에는 예약 하나를 취소할 때마다 notifications 문서를 클라이언트에서 직접 만들었다.
 * Rules가 클라이언트 생성을 superAdmin에게만 열어 두어, 기관 관리자가 실행하면 **첫 예약만 취소되고
 * permission-denied로 멈췄다**. 이제 알림은 취소 트리거가 보내고, 여기서는 사유만 예약 문서에 남긴다.
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
    orderBy: vi.fn((field: string, dir?: string) => ({ _type: 'orderBy', field, dir })),
    limit: vi.fn((n: number) => ({ _type: 'limit', n })),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    serverTimestamp: vi.fn(() => '__serverTimestamp__'),
}));

vi.mock('../../../lib/firebase', () => ({ db: {}, auth: { currentUser: null }, firebaseFunctions: {} }));
vi.mock('../../../lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('../../../lib/firestore/actorStamp', () => ({
    reservationActorStamp: () => ({ lastEditedByUid: 'admin1', lastEditId: 'edit-x' }),
}));

import * as fs from 'firebase/firestore';
import { cancelVehicleReservations } from '../../../lib/firestore/maintenance';

const snapOf = (ids: string[]) => ({
    size: ids.length,
    docs: ids.map(id => ({ id, data: () => ({ status: 'reserved' }) })),
});

describe('cancelVehicleReservations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('승인 대기·확정 예약을 모두 찾아 사유·스탬프와 함께 취소한다', async () => {
        vi.mocked(fs.getDocs).mockResolvedValue(snapOf(['r1', 'r2', 'r3']) as never);
        vi.mocked(fs.updateDoc).mockResolvedValue(undefined);

        const count = await cancelVehicleReservations('org1', 'v1', '스타렉스', '2026-11-12', '2026-11-14', '정비(엔진오일)로 차량 사용 차단');

        expect(count).toBe(3);
        expect(fs.where).toHaveBeenCalledWith('organizationId', '==', 'org1');
        expect(fs.where).toHaveBeenCalledWith('status', 'in', ['pending', 'reserved']);
        expect(fs.where).toHaveBeenCalledWith('date', '<=', '2026-11-14');
        expect(fs.updateDoc).toHaveBeenCalledTimes(3);
        expect(fs.updateDoc).toHaveBeenCalledWith(
            expect.objectContaining({ label: 'doc:reservations/r2' }),
            { status: 'cancelled', cancelReason: '정비(엔진오일)로 차량 사용 차단', lastEditedByUid: 'admin1', lastEditId: 'edit-x' },
        );
    });

    it('알림 문서를 클라이언트에서 직접 만들지 않는다 (Rules가 막아 일괄 취소가 멈추던 원인)', async () => {
        vi.mocked(fs.getDocs).mockResolvedValue(snapOf(['r1', 'r2']) as never);
        vi.mocked(fs.updateDoc).mockResolvedValue(undefined);

        await cancelVehicleReservations('org1', 'v1', '스타렉스', '2026-11-12', null, '폐차 (매각)');

        expect(fs.addDoc).not.toHaveBeenCalled();
        expect(fs.updateDoc).toHaveBeenCalledTimes(2);
        // 종료일이 없으면(폐차) 날짜 상한을 걸지 않는다
        expect(fs.where).not.toHaveBeenCalledWith('date', '<=', expect.anything());
    });
});
