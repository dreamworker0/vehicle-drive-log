/**
 * firestore/driveLogs/utils 단위 테스트
 *
 * 고정하는 계약:
 *  (1) `sanitizeUndefined` — Firestore가 거부하는 undefined/NaN만 걸러내고 Timestamp·FieldValue는 보존한다.
 *      Timestamp를 평범한 객체로 착각해 풀어헤치면 저장된 시각이 `{}`가 되어 **일지의 날짜가 사라진다.**
 *  (2) 모든 조회는 organizationId + vehicleId로 좁힌다(멀티테넌트 격리).
 *  (3) `getAdjacentDriveLogs`의 시각 해석 — Date / Timestamp / 직렬화로 toDate()가 소실된 형태를
 *      모두 받아야 한다. 운행일지 수정 화면은 React Router state로 로그를 넘겨서 세 번째 형태가 실제로 온다.
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
    query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ _type: 'where', field, op, value })),
    orderBy: vi.fn((field: string, dir?: string) => ({ _type: 'orderBy', field, dir })),
    limit: vi.fn((n: number) => ({ _type: 'limit', n })),
    getDocs: vi.fn(),
}));

vi.mock('../../../lib/firebase', () => ({ db: {}, auth: { currentUser: null }, firebaseFunctions: {} }));
vi.mock('../../../lib/sentry', () => ({ captureError: vi.fn() }));

import * as fs from 'firebase/firestore';
import { captureError } from '../../../lib/sentry';
import {
    sanitizeUndefined,
    hasLaterDriveLog,
    getLastVehicleEndKm,
    getLastVehicleDriveLog,
    getLastVehicleEndBattery,
    getVehicleEndKmBefore,
    getAdjacentDriveLogs,
} from '../../../lib/firestore/driveLogs/utils';
import type { DriveLog } from '../../../types/driveLog';

/** getDocs가 돌려줄 스냅샷을 만든다 */
function snap(docs: { id: string; data: Record<string, unknown> }[]) {
    return {
        empty: docs.length === 0,
        docs: docs.map(d => ({ id: d.id, data: () => d.data })),
    };
}

const mockGetDocs = vi.mocked(fs.getDocs) as unknown as ReturnType<typeof vi.fn>;

/** 마지막 query() 호출에 들어간 where 조건들 */
function lastWheres() {
    const calls = vi.mocked(fs.query).mock.calls;
    const last = calls[calls.length - 1];
    return (last.slice(1) as unknown as { _type: string; field: string; op: string; value: unknown }[])
        .filter(c => c._type === 'where');
}

function log(): DriveLog {
    return { id: 'cur', timestamp: new Date('2026-03-05T09:00:00Z') } as DriveLog;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('sanitizeUndefined', () => {
    it('undefined와 NaN 필드를 제거한다 — Firestore가 거부하는 값이다', () => {
        expect(sanitizeUndefined({ a: 1, b: undefined, c: NaN, d: '' })).toEqual({ a: 1, d: '' });
    });

    it('null과 0, 빈 문자열, false는 남긴다 — "값 없음"과 "0"은 다르다', () => {
        expect(sanitizeUndefined({ a: null, b: 0, c: '', d: false })).toEqual({ a: null, b: 0, c: '', d: false });
    });

    it('중첩 객체도 재귀적으로 정리한다', () => {
        expect(sanitizeUndefined({ a: { b: undefined, c: { d: NaN, e: 1 } } })).toEqual({ a: { c: { e: 1 } } });
    });

    it('배열 안의 undefined를 걷어낸다', () => {
        expect(sanitizeUndefined({ names: ['갑', undefined, '을'] })).toEqual({ names: ['갑', '을'] });
    });

    it('Date는 그대로 둔다 — 풀어헤치면 빈 객체가 되어 날짜가 사라진다', () => {
        const d = new Date('2026-03-05T00:00:00Z');
        expect(sanitizeUndefined({ at: d }).at).toBe(d);
    });

    it('Firestore Timestamp / FieldValue는 그대로 둔다', () => {
        const ts = { seconds: 1, nanoseconds: 0, toDate: () => new Date() };
        const fieldValue = { isEqual: () => true };
        const secondsOnly = { seconds: 1, nanoseconds: 0 };
        const input = { ts, fieldValue, secondsOnly };
        const out = sanitizeUndefined(input);
        expect(out.ts).toBe(ts);
        expect(out.fieldValue).toBe(fieldValue);
        expect(out.secondsOnly).toBe(secondsOnly);
    });

    it('원시값·null·undefined를 그대로 통과시킨다', () => {
        expect(sanitizeUndefined(3)).toBe(3);
        expect(sanitizeUndefined('a')).toBe('a');
        expect(sanitizeUndefined(null)).toBeNull();
        expect(sanitizeUndefined(undefined)).toBeUndefined();
    });
});

describe('조회 함수의 멀티테넌트 격리', () => {
    it.each([
        ['hasLaterDriveLog', () => hasLaterDriveLog('org1', 'v1', new Date())],
        ['getLastVehicleEndKm', () => getLastVehicleEndKm('org1', 'v1')],
        ['getLastVehicleDriveLog', () => getLastVehicleDriveLog('org1', 'v1')],
        ['getLastVehicleEndBattery', () => getLastVehicleEndBattery('org1', 'v1')],
        ['getVehicleEndKmBefore', () => getVehicleEndKmBefore('org1', 'v1', new Date())],
    ])('%s는 organizationId와 vehicleId로 좁힌다', async (_name, call) => {
        mockGetDocs.mockResolvedValue(snap([]));
        await call();
        const wheres = lastWheres();
        expect(wheres).toContainEqual({ _type: 'where', field: 'organizationId', op: '==', value: 'org1' });
        expect(wheres).toContainEqual({ _type: 'where', field: 'vehicleId', op: '==', value: 'v1' });
    });
});

describe('hasLaterDriveLog', () => {
    it('이후 기록이 있으면 true', async () => {
        mockGetDocs.mockResolvedValue(snap([{ id: 'a', data: {} }]));
        await expect(hasLaterDriveLog('org1', 'v1', new Date())).resolves.toBe(true);
    });

    it('없으면 false', async () => {
        mockGetDocs.mockResolvedValue(snap([]));
        await expect(hasLaterDriveLog('org1', 'v1', new Date())).resolves.toBe(false);
    });

    it('실패는 Sentry로 보고하고 그대로 던진다 — 조용히 false가 되면 소급 입력 판정이 틀어진다', async () => {
        mockGetDocs.mockRejectedValue(new Error('boom'));
        await expect(hasLaterDriveLog('org1', 'v1', new Date())).rejects.toThrow('boom');
        expect(captureError).toHaveBeenCalled();
    });
});

describe('getLastVehicleEndKm / getLastVehicleEndBattery', () => {
    it('마지막 기록의 endKm를 돌려주고, 기록이 없으면 null', async () => {
        mockGetDocs.mockResolvedValue(snap([{ id: 'a', data: { endKm: 51000 } }]));
        await expect(getLastVehicleEndKm('org1', 'v1')).resolves.toBe(51000);

        mockGetDocs.mockResolvedValue(snap([]));
        await expect(getLastVehicleEndKm('org1', 'v1')).resolves.toBeNull();
    });

    it('endKm가 0이면 null로 떨어진다 (현행 동작)', async () => {
        mockGetDocs.mockResolvedValue(snap([{ id: 'a', data: { endKm: 0 } }]));
        await expect(getLastVehicleEndKm('org1', 'v1')).resolves.toBeNull();
    });

    it('배터리는 0%도 값으로 살린다 — ??를 써서 방전 상태를 "모름"으로 만들지 않는다', async () => {
        mockGetDocs.mockResolvedValue(snap([{ id: 'a', data: { batteryEnd: 0 } }]));
        await expect(getLastVehicleEndBattery('org1', 'v1')).resolves.toBe(0);

        mockGetDocs.mockResolvedValue(snap([{ id: 'a', data: {} }]));
        await expect(getLastVehicleEndBattery('org1', 'v1')).resolves.toBeNull();
    });
});

describe('getLastVehicleDriveLog', () => {
    it('기록이 없으면 null', async () => {
        mockGetDocs.mockResolvedValue(snap([]));
        await expect(getLastVehicleDriveLog('org1', 'v1')).resolves.toBeNull();
    });

    it('excludeId 없이 부르면 최신 1건만 읽는다', async () => {
        mockGetDocs.mockResolvedValue(snap([{ id: 'a', data: { endKm: 10 } }]));
        const r = await getLastVehicleDriveLog('org1', 'v1');
        expect(r?.id).toBe('a');
        expect(vi.mocked(fs.limit)).toHaveBeenLastCalledWith(1);
    });

    it('excludeId를 주면 2건을 읽고 자기 자신을 걸러낸다 — 수정 화면에서 자기 기록을 직전 기록으로 삼지 않게', async () => {
        mockGetDocs.mockResolvedValue(snap([{ id: 'me', data: {} }, { id: 'older', data: {} }]));
        const r = await getLastVehicleDriveLog('org1', 'v1', 'me');
        expect(r?.id).toBe('older');
        expect(vi.mocked(fs.limit)).toHaveBeenLastCalledWith(2);
    });

    it('자기 자신뿐이면 null', async () => {
        mockGetDocs.mockResolvedValue(snap([{ id: 'me', data: {} }]));
        await expect(getLastVehicleDriveLog('org1', 'v1', 'me')).resolves.toBeNull();
    });
});

describe('getVehicleEndKmBefore', () => {
    it('기준 시각보다 이전 조건으로 조회한다 (소급 입력용)', async () => {
        const before = new Date('2026-03-05T00:00:00Z');
        mockGetDocs.mockResolvedValue(snap([{ id: 'a', data: { endKm: 500 } }]));
        await expect(getVehicleEndKmBefore('org1', 'v1', before)).resolves.toBe(500);
        expect(lastWheres()).toContainEqual({ _type: 'where', field: 'timestamp', op: '<', value: before });
    });

    it('이전 기록이 없으면 null', async () => {
        mockGetDocs.mockResolvedValue(snap([]));
        await expect(getVehicleEndKmBefore('org1', 'v1', new Date())).resolves.toBeNull();
    });
});

describe('getAdjacentDriveLogs', () => {
    it('직전은 가장 가까운 과거, 직후는 가장 가까운 미래를 고르고 자기 자신은 제외한다', async () => {
        mockGetDocs
            .mockResolvedValueOnce(snap([{ id: 'cur', data: {} }, { id: 'prev', data: {} }]))
            // 내림차순으로 받으므로 배열의 마지막이 "가장 가까운 미래"다
            .mockResolvedValueOnce(snap([{ id: 'far', data: {} }, { id: 'next', data: {} }]));

        const r = await getAdjacentDriveLogs('org1', 'v1', log());
        expect(r.prev?.id).toBe('prev');
        expect(r.next?.id).toBe('next');
    });

    it('앞뒤 기록이 없으면 둘 다 null', async () => {
        mockGetDocs.mockResolvedValue(snap([]));
        await expect(getAdjacentDriveLogs('org1', 'v1', log())).resolves.toEqual({ prev: null, next: null });
    });

    it.each([
        ['Date', new Date('2026-03-05T09:00:00Z')],
        ['Firestore Timestamp', { seconds: 1772701200, nanoseconds: 0, toDate: () => new Date('2026-03-05T09:00:00Z') }],
        // React Router state로 넘기면 toDate()가 사라지고 seconds만 남는다
        ['직렬화로 toDate()가 소실된 Timestamp', { seconds: 1772701200, nanoseconds: 0 }],
        ['ISO 문자열', '2026-03-05T09:00:00Z'],
    ])('timestamp가 %s 형태여도 시각으로 해석한다', async (_label, timestamp) => {
        mockGetDocs.mockResolvedValue(snap([]));
        await getAdjacentDriveLogs('org1', 'v1', { id: 'cur', timestamp } as unknown as DriveLog);

        const tsWhere = lastWheres().find(w => w.field === 'timestamp');
        expect(tsWhere?.value).toBeInstanceOf(Date);
        expect(isNaN((tsWhere?.value as Date).getTime())).toBe(false);
    });

    it('시각을 해석할 수 없으면 조회하지 않고 빈 결과를 낸다', async () => {
        const r = await getAdjacentDriveLogs('org1', 'v1', { id: 'cur', timestamp: 'not-a-date' } as unknown as DriveLog);
        expect(r).toEqual({ prev: null, next: null });
        expect(mockGetDocs).not.toHaveBeenCalled();
    });

    it('조회 실패는 Sentry로 보고하고 던진다', async () => {
        mockGetDocs.mockRejectedValue(new Error('boom'));
        await expect(getAdjacentDriveLogs('org1', 'v1', log())).rejects.toThrow('boom');
        expect(captureError).toHaveBeenCalled();
    });
});
