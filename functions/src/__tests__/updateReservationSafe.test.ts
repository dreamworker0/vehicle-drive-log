/**
 * updateReservationSafe.test.ts
 * - 예약 수정 콜러블은 코어(updateReservationTx) 앞의 얇은 래퍼다
 * - 지키는 것: 로그인 필수, **행위자(uid·기관·역할)는 토큰에서만** 가져오고 화면이 보낸 값은 무시,
 *   코어가 받는 필드만 골라 넘김(나머지는 문서에 닿지 않음), detachRecurring은 true일 때만 참
 */

const mockUpdateReservationTx = jest.fn();

jest.mock('../services/reservation/updateReservationCore', () => ({
    updateReservationTx: (...args: unknown[]) => mockUpdateReservationTx(...args),
}));
jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_opts: unknown, handler: (req: unknown) => unknown) => handler,
    HttpsError: class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
}));

import { updateReservationSafe } from '../handlers/callable/updateReservationSafe';

const handler = updateReservationSafe as unknown as (req: Record<string, unknown>) => Promise<Record<string, unknown>>;
const employee = { uid: 'u1', token: { orgId: 'org1', role: 'employee' } };

const fields = {
    reservationId: 'r1', vehicleId: 'v1', date: '2026-10-20', startTime: '09:00', endTime: '11:00',
    reservedByUid: 'u1', vehicleName: '스타리아', reservedByName: '홍길동', purpose: '방문',
    destination: '시청', routeDistance: 12.3, routeDuration: 25, routeTollFee: 0,
    passengerUids: ['u2'], passengerNames: ['김철수'], passengerCount: 1, groupId: 'g1',
};

describe('updateReservationSafe', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUpdateReservationTx.mockResolvedValue({ updated: true });
    });

    it('로그인하지 않으면 코어를 부르지 않고 거부한다', async () => {
        await expect(handler({ auth: null, data: fields })).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(mockUpdateReservationTx).not.toHaveBeenCalled();
    });

    it('코어가 받는 필드를 그대로 넘기고 행위자는 토큰에서 채운다', async () => {
        await expect(handler({ auth: employee, data: { ...fields, detachRecurring: true } }))
            .resolves.toEqual({ success: true, updated: true });

        expect(mockUpdateReservationTx).toHaveBeenCalledWith({
            ...fields, detachRecurring: true, actorUid: 'u1', actorOrgId: 'org1', actorRole: 'employee',
        });
    });

    it('화면이 보낸 행위자·기관·상태 값은 무시한다 — 권한 상승과 다른 기관 쓰기를 막는다', async () => {
        await handler({
            auth: employee,
            data: {
                ...fields,
                actorUid: 'someone-else', actorOrgId: 'org2', actorRole: 'superAdmin',
                organizationId: 'org2', status: 'approved', externalLoan: { borrowerOrg: 'x', driverName: 'y' },
            },
        });

        const arg = mockUpdateReservationTx.mock.calls[0][0];
        expect(arg).toMatchObject({ actorUid: 'u1', actorOrgId: 'org1', actorRole: 'employee' });
        expect(arg).not.toHaveProperty('organizationId');
        expect(arg).not.toHaveProperty('status');
        expect(arg).not.toHaveProperty('externalLoan');
    });

    it.each([['문자열 "true"', 'true'], ['1', 1], ['없음', undefined]])('detachRecurring이 %s면 거짓으로 넘긴다', async (_label, value) => {
        await handler({ auth: employee, data: { ...fields, detachRecurring: value } });
        expect(mockUpdateReservationTx.mock.calls[0][0].detachRecurring).toBe(false);
    });

    it('data가 비어 있어도 래퍼에서 터지지 않고 검증은 코어에 맡긴다', async () => {
        await handler({ auth: employee, data: undefined });
        expect(mockUpdateReservationTx).toHaveBeenCalledWith(expect.objectContaining({
            reservationId: undefined, actorUid: 'u1', detachRecurring: false,
        }));
    });

    it('코어의 거부는 그대로 전한다', async () => {
        const err = Object.assign(new Error('겹치는 예약'), { code: 'already-exists' });
        mockUpdateReservationTx.mockRejectedValueOnce(err);
        await expect(handler({ auth: employee, data: fields })).rejects.toBe(err);
    });
});
