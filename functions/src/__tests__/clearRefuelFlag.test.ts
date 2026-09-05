/**
 * clearRefuelFlag.test — 주유일지 작성 시 "주유 필요" 표시 해제 트리거
 *
 * 이 트리거는 표시를 **끄기만** 한다. 켜는 쪽(운행일지)과 짝이라, 둘 중 하나만
 * 어긋나도 표시가 영원히 켜져 있거나 켜지자마자 꺼지는 상태가 된다.
 * 여기서는 다음을 고정한다.
 *  (1) 주유하면 꺼진다
 *  (2) 켜져 있지 않으면 아무것도 쓰지 않는다 (needsRefuelAt이 거짓말하지 않도록)
 *  (3) 지난 날짜 영수증을 뒤늦게 입력해도 오늘 켜진 표시를 끄지 않는다
 *  (4) 타 기관 차량은 건드리지 않는다
 *  (5) 해제 실패가 주유 기록을 되돌리지 않는다
 */
import { getKSTDateString } from '../utils/kstDate';

const capturedTriggers: Record<string, any> = {};

jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (opts: any, handler: any) => {
        capturedTriggers[opts.document] = handler;
        return handler;
    },
}));

/** 차량 문서 저장소와 update 호출 기록 */
let vehicleDoc: Record<string, unknown> | null = null;
let updateShouldThrow = false;
const updates: Array<Record<string, unknown>> = [];

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => {
            if (name !== 'vehicles') throw new Error(`예상하지 못한 컬렉션 접근: ${name}`);
            return {
                doc: () => ({
                    get: async () => ({ exists: vehicleDoc !== null, data: () => vehicleDoc }),
                    update: async (patch: Record<string, unknown>) => {
                        if (updateShouldThrow) throw new Error('UNAVAILABLE');
                        updates.push(patch);
                    },
                }),
            };
        },
    }),
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TS') },
}));

const mockCaptureError = jest.fn();
jest.mock('../core/sentry', () => ({ captureError: (...a: unknown[]) => mockCaptureError(...a) }));

import '../handlers/triggers/clearRefuelFlag';

const ORG = 'org1';
const VEH = 'v1';
const fire = (data: Record<string, unknown>) =>
    capturedTriggers['fuelLogs/{logId}']({ data: { data: () => data }, params: { logId: 'f1' } });

const fuelLog = (over: Record<string, unknown> = {}) => ({
    organizationId: ORG, vehicleId: VEH, date: '2026-07-20', ...over,
});

describe('onFuelLogCreated — 주유 필요 표시 해제', () => {
    beforeEach(() => {
        vehicleDoc = null;
        updateShouldThrow = false;
        updates.length = 0;
        mockCaptureError.mockClear();
        jest.spyOn(console, 'error').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('주유일지가 작성되면 표시를 끈다', async () => {
        vehicleDoc = { organizationId: ORG, needsRefuel: true };

        await fire(fuelLog());

        expect(updates).toEqual([{ needsRefuel: false, needsRefuelAt: 'SERVER_TS' }]);
    });

    it('표시가 켜져 있지 않으면 아무것도 쓰지 않는다', async () => {
        // 매 주유마다 false를 덮어쓰면 needsRefuelAt이 '상태가 바뀐 시각'을 가리키지 못해
        // 신선도 판정이 무너진다.
        vehicleDoc = { organizationId: ORG };

        await fire(fuelLog());

        expect(updates).toHaveLength(0);
    });

    it('지난 날짜 주유 영수증은 오늘 켜진 표시를 끄지 않는다', async () => {
        // 지난주 영수증을 오늘 입력했다고 지금 연료가 있는 것은 아니다.
        const flaggedAt = new Date(2026, 6, 20, 14, 0);
        vehicleDoc = { organizationId: ORG, needsRefuel: true, needsRefuelAt: flaggedAt };

        await fire(fuelLog({ date: '2026-07-13' }));

        expect(updates).toHaveLength(0);
    });

    it('표시된 날과 같은 날 주유하면 끈다', async () => {
        // 표시(14:00) → 주유(15:00)가 가장 흔한 순서인데, 주유일지에는 날짜만 있어
        // 시:분을 비교할 수 없다. 같은 날이면 끄는 쪽을 택한다.
        const flaggedAt = new Date(2026, 6, 20, 14, 0);
        vehicleDoc = { organizationId: ORG, needsRefuel: true, needsRefuelAt: flaggedAt };

        await fire(fuelLog({ date: getKSTDateString(flaggedAt) }));

        expect(updates).toEqual([{ needsRefuel: false, needsRefuelAt: 'SERVER_TS' }]);
    });

    it('다른 기관의 차량은 건드리지 않는다', async () => {
        vehicleDoc = { organizationId: 'other-org', needsRefuel: true };

        await fire(fuelLog());

        expect(updates).toHaveLength(0);
    });

    it('차량 문서가 없으면 건너뛴다', async () => {
        vehicleDoc = null;

        await fire(fuelLog());

        expect(updates).toHaveLength(0);
    });

    it('해제에 실패해도 던지지 않는다 — 주유 기록까지 되돌릴 이유가 없다', async () => {
        vehicleDoc = { organizationId: ORG, needsRefuel: true };
        updateShouldThrow = true;

        await expect(fire(fuelLog())).resolves.toBeUndefined();
        expect(mockCaptureError).toHaveBeenCalled();
    });

    it('기관·차량 정보가 없는 문서는 조용히 넘어간다', async () => {
        await fire({ date: '2026-07-20' });

        expect(updates).toHaveLength(0);
        expect(mockCaptureError).not.toHaveBeenCalled();
    });
});
