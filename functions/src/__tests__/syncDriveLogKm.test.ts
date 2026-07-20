/**
 * syncDriveLogKm.test.ts — 운행일지 km 연쇄 재정합 트리거 단위 테스트
 *
 * 소급(중간) 삽입 시 "숫자가 어긋나지 않도록" 뒤 기록들의 startKm/endKm을 diff만큼
 * 연쇄 이동시키는 핵심 로직(syncNextLogStartKm)과, onDriveLogCreated의 currentKm 분기
 * (소급이면 누적 km를 증분하지 않음)를 검증한다.
 *
 * Firestore는 인메모리 페이크로 대체한다. 페이크 db는 import 시점에 1회 캡처되므로
 * (const db = getFirestore()) 단일 인스턴스를 두고 __setDocs로 매 테스트 상태를 리셋한다.
 */

// ── 인메모리 페이크 Firestore ──
jest.mock('firebase-admin/firestore', () => {
    const store: { docs: Array<{ id: string; _col: string; _data: Record<string, unknown> }>; updates: Array<{ col: string; id: string; patch: Record<string, unknown> }> } = {
        docs: [],
        updates: [],
    };

    const applyFilter = (v: unknown, op: string, val: unknown): boolean => {
        switch (op) {
            case '==': return v === val;
            case '>': return (v as number) > (val as number);
            case '<': return (v as number) < (val as number);
            case '>=': return (v as number) >= (val as number);
            case '<=': return (v as number) <= (val as number);
            default: return true;
        }
    };

    const collection = (name: string) => {
        const filters: Array<[string, string, unknown]> = [];
        let order: [string, string] | null = null;
        let lim: number | null = null;
        const builder: Record<string, unknown> = {
            where(f: string, op: string, val: unknown) { filters.push([f, op, val]); return builder; },
            orderBy(f: string, dir: string) { order = [f, dir]; return builder; },
            limit(n: number) { lim = n; return builder; },
            doc(id: string) {
                return {
                    get: async () => {
                        const d = store.docs.find(x => x.id === id && x._col === name);
                        return { exists: !!d, data: () => d?._data };
                    },
                    update: async (patch: Record<string, unknown>) => {
                        const d = store.docs.find(x => x.id === id && x._col === name);
                        if (d) { Object.assign(d._data, patch); store.updates.push({ col: name, id, patch }); }
                    },
                };
            },
            get: async () => {
                let res = store.docs.filter(d => d._col === name && filters.every(([f, op, val]) => applyFilter(d._data[f], op, val)));
                if (order) {
                    const [f, dir] = order;
                    res = [...res].sort((a, b) => {
                        const av = a._data[f] as number; const bv = b._data[f] as number;
                        const c = av < bv ? -1 : av > bv ? 1 : 0;
                        return c * (dir === 'desc' ? -1 : 1);
                    });
                }
                if (lim != null) res = res.slice(0, lim);
                return {
                    empty: res.length === 0,
                    docs: res.map(d => ({
                        id: d.id,
                        data: () => d._data,
                        ref: {
                            update: async (patch: Record<string, unknown>) => {
                                Object.assign(d._data, patch);
                                store.updates.push({ col: name, id: d.id, patch });
                            },
                        },
                    })),
                };
            },
        };
        return builder;
    };

    const db = {
        collection,
        __setDocs: (docs: Array<{ id: string; col?: string; data: Record<string, unknown> }>) => {
            store.docs = docs.map(d => ({ id: d.id, _col: d.col || 'driveLogs', _data: { ...d.data } }));
            store.updates = [];
        },
        __updates: () => store.updates,
        __get: (col: string, id: string) => store.docs.find(x => x.id === id && x._col === col)?._data,
    };

    return {
        getFirestore: () => db,
        FieldValue: {
            serverTimestamp: () => 'SERVER_TS',
            increment: (n: number) => ({ __increment: n }),
        },
    };
});

// 트리거 래퍼는 핸들러를 그대로 반환
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_o: unknown, h: Function) => h,
    onDocumentUpdated: (_o: unknown, h: Function) => h,
    onDocumentDeleted: (_o: unknown, h: Function) => h,
}));

// 부수 서비스는 no-op 모킹 (테스트 대상 밖)
jest.mock('../services/statistics/updateAggregatedStats', () => ({
    handleStatsOnCreate: jest.fn(async () => undefined),
    handleStatsOnUpdate: jest.fn(async () => undefined),
    handleStatsOnDelete: jest.fn(async () => undefined),
}));
jest.mock('../handlers/sync/conflictResolver', () => ({
    resolveDriveLogConflict: jest.fn(async () => false),
}));
jest.mock('../core/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../utils/helpers', () => ({ recordHeartbeat: jest.fn(async () => undefined) }));

import { getFirestore } from 'firebase-admin/firestore';
import { syncNextLogStartKm, onDriveLogCreated } from '../handlers/triggers/syncDriveLogKm';

 
const db = getFirestore() as any;

const ORG = 'org1';
const VEH = 'v1';
const d = (day: number) => new Date(2026, 6, day); // 2026-07-DD

interface SeedLog { id: string; timestamp: Date; startKm: number; endKm: number; }
function seedLogs(logs: SeedLog[], extra: Array<{ id: string; col: string; data: Record<string, unknown> }> = []) {
    db.__setDocs([
        ...logs.map(l => ({
            id: l.id,
            col: 'driveLogs',
            data: { organizationId: ORG, vehicleId: VEH, timestamp: l.timestamp, startKm: l.startKm, endKm: l.endKm },
        })),
        ...extra,
    ]);
}

describe('syncNextLogStartKm — km 연쇄 재정합', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('빈틈을 정확히 메우면(다음 startKm과 일치) 뒤 기록을 전혀 건드리지 않는다', async () => {
        // A(60000→60123) [삽입 R 60123→60200] B(60200→60250)
        seedLogs([{ id: 'B', timestamp: d(15), startKm: 60200, endKm: 60250 }]);
        await syncNextLogStartKm(ORG, VEH, d(10), 60200);

        expect(db.__updates()).toHaveLength(0);
        expect(db.__get('driveLogs', 'B')).toMatchObject({ startKm: 60200, endKm: 60250 });
    });

    it('빈틈이 없으면 뒤 기록 전체를 diff만큼 이동시키되 각 기록의 거리(distance)는 보존한다', async () => {
        // 연속 체인 B(150→200) C(200→260)에 거리 30짜리 R을 끼움 → 뒤 기록 +30 이동
        seedLogs([
            { id: 'B', timestamp: d(15), startKm: 150, endKm: 200 },
            { id: 'C', timestamp: d(20), startKm: 200, endKm: 260 },
        ]);
        await syncNextLogStartKm(ORG, VEH, d(10), 180); // 삽입 R의 endKm=180

        expect(db.__get('driveLogs', 'B')).toMatchObject({ startKm: 180, endKm: 230 }); // 거리 50 유지
        expect(db.__get('driveLogs', 'C')).toMatchObject({ startKm: 230, endKm: 290 }); // 거리 60 유지
        expect(db.__updates()).toHaveLength(2);
    });

    it('연쇄 도중 startKm이 이미 맞으면 그 지점에서 즉시 멈춘다', async () => {
        seedLogs([
            { id: 'B', timestamp: d(15), startKm: 150, endKm: 200 },
            { id: 'C', timestamp: d(20), startKm: 200, endKm: 260 },
        ]);
        await syncNextLogStartKm(ORG, VEH, d(10), 150); // 첫 대상 B의 startKm(150)과 즉시 일치

        expect(db.__updates()).toHaveLength(0);
        expect(db.__get('driveLogs', 'B')).toMatchObject({ startKm: 150, endKm: 200 });
        expect(db.__get('driveLogs', 'C')).toMatchObject({ startKm: 200, endKm: 260 });
    });

    it('연쇄는 최대 20건까지만 전파하고 그 뒤 기록은 건드리지 않는다(무한 루프 방지)', async () => {
        // 22개의 기록을 모두 어긋나게(startKm=0, endKm=10) 배치 → 20개만 갱신되어야 함
        const logs: SeedLog[] = Array.from({ length: 22 }, (_, i) => ({
            id: `L${i + 1}`, timestamp: d(i + 1), startKm: 0, endKm: 10,
        }));
        seedLogs(logs);
        await syncNextLogStartKm(ORG, VEH, new Date(2026, 5, 30), 5); // 6/30 이후 전부 대상

        expect(db.__updates()).toHaveLength(20);
        // 21번째·22번째는 원본 그대로
        expect(db.__get('driveLogs', 'L21')).toMatchObject({ startKm: 0, endKm: 10 });
        expect(db.__get('driveLogs', 'L22')).toMatchObject({ startKm: 0, endKm: 10 });
    });
});

describe('onDriveLogCreated — 차량 누적 km 분기', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    const makeEvent = (data: Record<string, unknown>) => ({
        data: { data: () => data },
        params: { logId: 'R' },
    });

    it('소급(isRetroactive) 기록은 차량 currentKm을 증분하지 않는다', async () => {
        seedLogs(
            [{ id: 'B', timestamp: d(15), startKm: 60200, endKm: 60250 }],
            [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 60250 } }],
        );
        await (onDriveLogCreated as unknown as Function)(makeEvent({
            organizationId: ORG, vehicleId: VEH, timestamp: d(10),
            startKm: 60123, endKm: 60200, distance: 77, isRetroactive: true,
        }));

        // 차량 문서에 대한 업데이트(currentKm 증분)가 없어야 한다
        const vehUpdates = db.__updates().filter((u: { col: string }) => u.col === 'vehicles');
        expect(vehUpdates).toHaveLength(0);
        expect(db.__get('vehicles', VEH)).toMatchObject({ currentKm: 60250 });
        // 빈틈을 정확히 메웠으므로 뒤 기록(B)도 변동 없음
        expect(db.__get('driveLogs', 'B')).toMatchObject({ startKm: 60200, endKm: 60250 });
    });

    it('최신(비소급) 기록은 차량 currentKm을 주행거리만큼 증분한다', async () => {
        seedLogs(
            [],
            [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 1000 } }],
        );
        await (onDriveLogCreated as unknown as Function)(makeEvent({
            organizationId: ORG, vehicleId: VEH, timestamp: d(20),
            startKm: 1000, endKm: 1050, distance: 50, isRetroactive: false,
        }));

        const vehUpdates = db.__updates().filter((u: { col: string }) => u.col === 'vehicles');
        expect(vehUpdates).toHaveLength(1);
        expect(vehUpdates[0].patch).toEqual({ currentKm: { __increment: 50 } });
    });
});
