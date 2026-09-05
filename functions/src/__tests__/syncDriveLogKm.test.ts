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
    const store: { docs: Array<{ id: string; _col: string; _data: Record<string, unknown> }>; updates: Array<{ col: string; id: string; patch: Record<string, unknown> }>; commits: number } = {
        docs: [],
        updates: [],
        commits: 0,
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

    // FieldValue.increment는 실제 Firestore처럼 숫자로 반영한다 (기록되는 patch는 원본 그대로 남긴다)
    const applyPatch = (target: Record<string, unknown>, patch: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(patch)) {
            const inc = (v as { __increment?: number })?.__increment;
            target[k] = typeof inc === 'number' ? ((target[k] as number) ?? 0) + inc : v;
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
                        if (d) { applyPatch(d._data, patch); store.updates.push({ col: name, id, patch }); }
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
                                applyPatch(d._data, patch);
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
        // 배치: commit 시점에 각 ref.update를 순서대로 적용한다 (커밋 횟수도 기록)
        batch: () => {
            const ops: Array<{ ref: { update: (p: Record<string, unknown>) => Promise<void> }; patch: Record<string, unknown> }> = [];
            return {
                update(ref: { update: (p: Record<string, unknown>) => Promise<void> }, patch: Record<string, unknown>) {
                    ops.push({ ref, patch });
                },
                commit: async () => {
                    store.commits++;
                    for (const op of ops) await op.ref.update(op.patch);
                },
            };
        },
        __setDocs: (docs: Array<{ id: string; col?: string; data: Record<string, unknown> }>) => {
            store.docs = docs.map(d => ({ id: d.id, _col: d.col || 'driveLogs', _data: { ...d.data } }));
            store.updates = [];
            store.commits = 0;
        },
        __updates: () => store.updates,
        __commits: () => store.commits,
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
import {
    syncNextLogStartKm,
    onDriveLogCreated,
    onDriveLogUpdated,
    onDriveLogDeleted,
    KM_SYNC_REV_FIELD,
    KM_SYNC_CONTINUE_FIELD,
} from '../handlers/triggers/syncDriveLogKm';
import { handleStatsOnUpdate } from '../services/statistics/updateAggregatedStats';

 
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

    it('20건을 넘겨도 한 호출에서 끝까지 전파한다 (예전 MAX_CHAIN=20 절단 없음)', async () => {
        // 22개를 모두 어긋나게 두면 22개 전부가 한 호출에서 재정합돼야 한다.
        // 예전 구현은 20개에서 멈추고 나머지를 "트리거 재발동"에 떠넘겼다(파도 증폭의 원인).
        const logs: SeedLog[] = Array.from({ length: 22 }, (_, i) => ({
            id: `L${i + 1}`, timestamp: d(i + 1), startKm: 0, endKm: 10,
        }));
        seedLogs(logs);
        const r = await syncNextLogStartKm(ORG, VEH, new Date(2026, 5, 30), 5);

        expect(r).toMatchObject({ processed: 22, reachedEnd: true, truncated: false });
        // 각 기록의 거리 10을 보존하며 누적: L_n = startKm 5+10(n-1) → endKm +10
        expect(db.__get('driveLogs', 'L21')).toMatchObject({ startKm: 205, endKm: 215 });
        expect(db.__get('driveLogs', 'L22')).toMatchObject({ startKm: 215, endKm: 225 });
        // 문서당 개별 커밋이 아니라 페이지 배치로 묶여야 한다 (22건 → 커밋 1회)
        expect(db.__commits()).toBe(1);
    });

    it('연쇄 쓰기에는 재발동 차단 표시(kmSyncRev)가 함께 올라간다', async () => {
        seedLogs([{ id: 'B', timestamp: d(15), startKm: 150, endKm: 200 }]);
        await syncNextLogStartKm(ORG, VEH, d(10), 180);

        const patch = db.__updates()[0].patch;
        expect(patch).toMatchObject({ startKm: 180, endKm: 230, [KM_SYNC_REV_FIELD]: { __increment: 1 } });
        expect(db.__get('driveLogs', 'B')![KM_SYNC_REV_FIELD]).toBe(1);
    });

    it('상한을 넘으면 마지막 문서에 이어받기 표시를 남기고 중단한다', async () => {
        // 상한(1000)보다 1건 많게 배치 → 1000건 처리 후 이어받기 표시
        const logs: SeedLog[] = Array.from({ length: 1001 }, (_, i) => ({
            id: `L${i + 1}`, timestamp: d(i + 1), startKm: 0, endKm: 10,
        }));
        seedLogs(logs);
        const r = await syncNextLogStartKm(ORG, VEH, new Date(2026, 5, 30), 5);

        expect(r).toMatchObject({ processed: 1000, truncated: true, reachedEnd: false });
        expect(db.__get('driveLogs', 'L1000')).toMatchObject({ [KM_SYNC_CONTINUE_FIELD]: true });
        // 1001번째는 아직 원본 그대로 — 이어받기 트리거가 처리한다
        expect(db.__get('driveLogs', 'L1001')).toMatchObject({ startKm: 0, endKm: 10 });
    });
});

describe('onDriveLogUpdated — 연쇄 재발동 차단', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    const makeUpdateEvent = (before: Record<string, unknown>, after: Record<string, unknown>, id = 'B') => ({
        data: {
            before: { data: () => before },
            after: { data: () => after, ref: db.collection('driveLogs').doc(id) },
        },
        params: { logId: id },
    });

    it('연쇄가 만든 update(kmSyncRev 증가)는 아무 부수효과 없이 즉시 반환한다', async () => {
        seedLogs(
            [
                { id: 'B', timestamp: d(15), startKm: 180, endKm: 230 },
                { id: 'C', timestamp: d(20), startKm: 200, endKm: 260 },
            ],
            [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 260 } }],
        );

        await (onDriveLogUpdated as unknown as Function)(makeUpdateEvent(
            { organizationId: ORG, vehicleId: VEH, timestamp: d(15), startKm: 150, endKm: 200, [KM_SYNC_REV_FIELD]: 0 },
            { organizationId: ORG, vehicleId: VEH, timestamp: d(15), startKm: 180, endKm: 230, [KM_SYNC_REV_FIELD]: 1 },
        ));

        // 뒤 기록(C)도, 차량 누적 km도 건드리지 않는다 — 재발동이 여기서 끊긴다
        expect(db.__updates()).toHaveLength(0);
        expect(db.__get('driveLogs', 'C')).toMatchObject({ startKm: 200, endKm: 260 });
        expect(handleStatsOnUpdate).not.toHaveBeenCalled();
    });

    it('이어받기 표시가 있으면 남은 구간을 계속 재정합하고 표시를 지운다', async () => {
        seedLogs([
            { id: 'B', timestamp: d(15), startKm: 180, endKm: 230 },
            { id: 'C', timestamp: d(20), startKm: 200, endKm: 260 },
        ]);

        await (onDriveLogUpdated as unknown as Function)(makeUpdateEvent(
            { organizationId: ORG, vehicleId: VEH, timestamp: d(15), startKm: 150, endKm: 200, [KM_SYNC_REV_FIELD]: 0 },
            {
                organizationId: ORG, vehicleId: VEH, timestamp: d(15), startKm: 180, endKm: 230,
                [KM_SYNC_REV_FIELD]: 1, [KM_SYNC_CONTINUE_FIELD]: true,
            },
        ));

        expect(db.__get('driveLogs', 'B')).toMatchObject({ [KM_SYNC_CONTINUE_FIELD]: false });
        // 남은 구간(C)이 B의 endKm(230)에 맞춰 이동 — 거리 60 보존
        expect(db.__get('driveLogs', 'C')).toMatchObject({ startKm: 230, endKm: 290 });
    });

    it('이어받기 표시는 재정합을 끝낸 뒤에 지운다 (중간에 죽어도 재개 근거가 남도록)', async () => {
        // 먼저 지우면 도중 실패 시 표시가 사라져 남은 구간이 조용히 방치된다.
        // 이 트리거는 retry: false라 이벤트 재전달도 없으므로 순서 자체가 안전장치다.
        seedLogs([
            { id: 'B', timestamp: d(15), startKm: 180, endKm: 230 },
            { id: 'C', timestamp: d(20), startKm: 200, endKm: 260 },
        ]);

        await (onDriveLogUpdated as unknown as Function)(makeUpdateEvent(
            { organizationId: ORG, vehicleId: VEH, timestamp: d(15), startKm: 150, endKm: 200, [KM_SYNC_REV_FIELD]: 0 },
            {
                organizationId: ORG, vehicleId: VEH, timestamp: d(15), startKm: 180, endKm: 230,
                [KM_SYNC_REV_FIELD]: 1, [KM_SYNC_CONTINUE_FIELD]: true,
            },
        ));

        const order = db.__updates().map((u: { id: string; patch: Record<string, unknown> }) => ({
            id: u.id,
            clearsFlag: u.patch[KM_SYNC_CONTINUE_FIELD] === false,
        }));
        // C(남은 구간) 재정합이 먼저, B의 표시 해제가 나중
        expect(order.map(o => `${o.id}${o.clearsFlag ? ':clear' : ''}`)).toEqual(['C', 'B:clear']);
    });

    it('사람이 한 수정(kmSyncRev 동일)은 정상 경로로 처리한다', async () => {
        seedLogs([
            { id: 'B', timestamp: d(15), startKm: 150, endKm: 210 },
            { id: 'C', timestamp: d(20), startKm: 200, endKm: 260 },
        ]);

        await (onDriveLogUpdated as unknown as Function)(makeUpdateEvent(
            { organizationId: ORG, vehicleId: VEH, timestamp: d(15), startKm: 150, endKm: 200 },
            { organizationId: ORG, vehicleId: VEH, timestamp: d(15), startKm: 150, endKm: 210 },
        ));

        // endKm이 200 → 210으로 늘었으므로 뒤 기록도 +10 이동해야 한다
        expect(db.__get('driveLogs', 'C')).toMatchObject({ startKm: 210, endKm: 270 });
    });
    it('소급 표시를 지운 수정은 차량 누적 km를 다시 따라가게 한다', async () => {
        // after는 델타가 아니라 문서 전체다. 예전에는 "없으면 예전 값"으로 되돌려, 소급으로
        // 적었던 일지를 오늘 도착으로 고쳐도 옛 true가 되살아나 km 갱신을 계속 건너뛰었다.
        // 화면은 고쳐졌는데 차량 상태만 안 따라오는 상태였다.
        seedLogs(
            [{ id: 'B', timestamp: d(20), startKm: 1000, endKm: 1050 }],
            [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 1050 } }],
        );

        await (onDriveLogUpdated as unknown as Function)(makeUpdateEvent(
            { organizationId: ORG, vehicleId: VEH, timestamp: d(20), startKm: 1000, endKm: 1050, isRetroactive: true },
            // isRetroactive 키가 아예 없다 — deleteField()로 지운 뒤의 모양
            { organizationId: ORG, vehicleId: VEH, timestamp: d(20), startKm: 1000, endKm: 1080 },
        ));

        const kmPatches = db.__updates()
            .filter((u: { col: string; patch: Record<string, unknown> }) => u.col === 'vehicles' && 'currentKm' in u.patch);
        expect(kmPatches).toHaveLength(1);
    });

    it('여전히 소급인 수정은 차량 누적 km를 건드리지 않는다', async () => {
        seedLogs(
            [{ id: 'B', timestamp: d(20), startKm: 1000, endKm: 1050 }],
            [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 1050 } }],
        );

        await (onDriveLogUpdated as unknown as Function)(makeUpdateEvent(
            { organizationId: ORG, vehicleId: VEH, timestamp: d(20), startKm: 1000, endKm: 1050, isRetroactive: true },
            { organizationId: ORG, vehicleId: VEH, timestamp: d(20), startKm: 1000, endKm: 1080, isRetroactive: true },
        ));

        const kmPatches = db.__updates()
            .filter((u: { col: string; patch: Record<string, unknown> }) => u.col === 'vehicles' && 'currentKm' in u.patch);
        expect(kmPatches).toHaveLength(0);
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

    it('소급 삽입이 최신 기록까지 밀면 차량 currentKm을 그 폭만큼 보정한다', async () => {
        // B(150→200)만 있는 차량에 빈틈 없이 R(120→180)을 끼우면 B가 +30 밀린다
        // → 최신 기록의 endKm이 200 → 230이므로 currentKm도 +30이어야 한다.
        // (예전에는 연쇄가 만든 update의 트리거가 "최신 기록 수정"으로 판정해 우연히 처리했다)
        seedLogs(
            [{ id: 'B', timestamp: d(15), startKm: 150, endKm: 200 }],
            [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 200 } }],
        );
        await (onDriveLogCreated as unknown as Function)(makeEvent({
            organizationId: ORG, vehicleId: VEH, timestamp: d(10),
            startKm: 120, endKm: 180, distance: 60, isRetroactive: true,
        }));

        expect(db.__get('driveLogs', 'B')).toMatchObject({ startKm: 180, endKm: 230 });
        const vehUpdates = db.__updates().filter((u: { col: string }) => u.col === 'vehicles');
        expect(vehUpdates).toHaveLength(1);
        expect(vehUpdates[0].patch).toEqual({ currentKm: { __increment: 30 } });
    });
});

describe('주유 필요 표시(needsRefuel) 갱신', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    const makeEvent = (data: Record<string, unknown>) => ({
        data: { data: () => data },
        params: { logId: 'R' },
    });
    const makeUpdateEvent = (before: Record<string, unknown>, after: Record<string, unknown>, id = 'B') => ({
        data: {
            before: { data: () => before },
            after: { data: () => after, ref: db.collection('driveLogs').doc(id) },
        },
        params: { logId: id },
    });
    const refuelPatches = () => db.__updates()
        .filter((u: { col: string; patch: Record<string, unknown> }) => u.col === 'vehicles' && 'needsRefuel' in u.patch)
        .map((u: { patch: Record<string, unknown> }) => u.patch);

    it('최신 기록에서 표시하면 차량에 주유 필요를 켠다', async () => {
        seedLogs([], [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 1000 } }]);

        await (onDriveLogCreated as unknown as Function)(makeEvent({
            organizationId: ORG, vehicleId: VEH, timestamp: d(20),
            startKm: 1000, endKm: 1050, distance: 50, needsRefuel: true,
        }));

        expect(refuelPatches()).toEqual([{ needsRefuel: true, needsRefuelAt: 'SERVER_TS' }]);
        expect(db.__get('vehicles', VEH)).toMatchObject({ needsRefuel: true });
    });

    it('표시하지 않은 운행은 차량 문서를 건드리지 않는다 — 끄지도 않는다', async () => {
        // 끄는 것은 주유일지·관리자 몫이다. 운행일지는 "부족했다"만 증언할 수 있다.
        seedLogs([], [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 1000, needsRefuel: true } }]);

        await (onDriveLogCreated as unknown as Function)(makeEvent({
            organizationId: ORG, vehicleId: VEH, timestamp: d(20),
            startKm: 1000, endKm: 1050, distance: 50,
        }));

        expect(refuelPatches()).toHaveLength(0);
        expect(db.__get('vehicles', VEH)).toMatchObject({ needsRefuel: true });
    });

    it('소급 입력은 표시를 켜지 않는다 — 그 사이 누가 주유했을 수 있다', async () => {
        seedLogs(
            [{ id: 'B', timestamp: d(15), startKm: 60200, endKm: 60250 }],
            [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 60250 } }],
        );

        await (onDriveLogCreated as unknown as Function)(makeEvent({
            organizationId: ORG, vehicleId: VEH, timestamp: d(10),
            startKm: 60123, endKm: 60200, distance: 77, isRetroactive: true, needsRefuel: true,
        }));

        expect(refuelPatches()).toHaveLength(0);
    });

    it('관리자가 해제한 뒤 도착한 과거 운행은 표시를 되살리지 않는다', async () => {
        // 15:00에 해제 → 09:00 운행이 16:00에 뒤늦게 저장. 뒤에 다른 기록이 없어
        // 소급으로 판정되지 않으므로, 신선도 가드가 없으면 관리자 조치가 되돌려진다.
        seedLogs(
            [],
            [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 1000, needsRefuel: false, needsRefuelAt: d(21) } }],
        );

        await (onDriveLogCreated as unknown as Function)(makeEvent({
            organizationId: ORG, vehicleId: VEH, timestamp: d(20),
            startKm: 1000, endKm: 1050, distance: 50, needsRefuel: true,
        }));

        expect(refuelPatches()).toHaveLength(0);
        expect(db.__get('vehicles', VEH)).toMatchObject({ needsRefuel: false });
    });

    it('다른 기관의 차량은 건드리지 않는다', async () => {
        seedLogs([], [{ id: VEH, col: 'vehicles', data: { organizationId: 'other-org', currentKm: 1000 } }]);

        await (onDriveLogCreated as unknown as Function)(makeEvent({
            organizationId: ORG, vehicleId: VEH, timestamp: d(20),
            startKm: 1000, endKm: 1050, distance: 50, needsRefuel: true,
        }));

        expect(refuelPatches()).toHaveLength(0);
    });

    it('이미 켜져 있으면 다시 쓰지 않는다 — needsRefuelAt이 "바뀐 시각"을 지켜야 한다', async () => {
        // 표시된 운행마다 덮어쓰면 화면의 "언제부터 필요했는지"가 계속 새 값으로 밀린다.
        seedLogs([], [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 1000, needsRefuel: true, needsRefuelAt: d(19) } }]);

        await (onDriveLogCreated as unknown as Function)(makeEvent({
            organizationId: ORG, vehicleId: VEH, timestamp: d(20),
            startKm: 1000, endKm: 1050, distance: 50, needsRefuel: true,
        }));

        expect(refuelPatches()).toHaveLength(0);
    });

    it('수정으로 새로 표시되면 반영한다', async () => {
        seedLogs(
            [{ id: 'B', timestamp: d(20), startKm: 1000, endKm: 1050 }],
            [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 1050 } }],
        );

        await (onDriveLogUpdated as unknown as Function)(makeUpdateEvent(
            { organizationId: ORG, vehicleId: VEH, timestamp: d(20), startKm: 1000, endKm: 1050 },
            { organizationId: ORG, vehicleId: VEH, timestamp: d(20), startKm: 1000, endKm: 1050, needsRefuel: true },
        ));

        expect(refuelPatches()).toEqual([{ needsRefuel: true, needsRefuelAt: 'SERVER_TS' }]);
    });

    it('주유 표시 갱신이 터져도 차량 누적 km 갱신은 그대로 진행된다', async () => {
        // 위치 갱신과 같은 이유다 — 두 트리거는 retry: false라 표시용 실패가 바깥으로
        // 올라가면 회계가 통째로 유실된다. 표시는 다음 운행이 다시 맞춰 주지만
        // currentKm은 스스로 복구되지 않는다.
        const explodingTimestamp = { toDate: () => { throw new Error('UNAVAILABLE'); } };
        seedLogs(
            [{ id: 'B', timestamp: d(20), startKm: 1000, endKm: 1060 }],
            [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 1050, needsRefuelAt: explodingTimestamp } }],
        );

        await (onDriveLogUpdated as unknown as Function)(makeUpdateEvent(
            { organizationId: ORG, vehicleId: VEH, timestamp: d(20), startKm: 1000, endKm: 1050 },
            { organizationId: ORG, vehicleId: VEH, timestamp: d(20), startKm: 1000, endKm: 1060, needsRefuel: true },
        ));

        expect(refuelPatches()).toHaveLength(0);
        const kmPatches = db.__updates()
            .filter((u: { col: string; patch: Record<string, unknown> }) => u.col === 'vehicles' && 'currentKm' in u.patch)
            .map((u: { patch: Record<string, unknown> }) => u.patch);
        expect(kmPatches).toEqual([{ currentKm: { __increment: 10 } }]);
    });
});

describe('차량 현재 위치(currentSiteId) 갱신', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    const makeEvent = (data: Record<string, unknown>) => ({
        data: { data: () => data },
        params: { logId: 'R' },
    });
    const makeUpdateEvent = (before: Record<string, unknown>, after: Record<string, unknown>, id = 'B') => ({
        data: {
            before: { data: () => before },
            after: { data: () => after, ref: db.collection('driveLogs').doc(id) },
        },
        params: { logId: id },
    });
    const vehicleSitePatches = () => db.__updates()
        .filter((u: { col: string; patch: Record<string, unknown> }) => u.col === 'vehicles' && 'currentSiteId' in u.patch)
        .map((u: { patch: Record<string, unknown> }) => u.patch);

    it('최신 기록이면 세운 곳을 차량의 현재 위치로 반영한다', async () => {
        seedLogs([], [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 1000 } }]);

        await (onDriveLogCreated as unknown as Function)(makeEvent({
            organizationId: ORG, vehicleId: VEH, timestamp: d(20),
            startKm: 1000, endKm: 1050, distance: 50, endSiteId: 'site_a',
        }));

        expect(vehicleSitePatches()).toEqual([{ currentSiteId: 'site_a', currentSiteUpdatedAt: 'SERVER_TS' }]);
        expect(db.__get('vehicles', VEH)).toMatchObject({ currentSiteId: 'site_a' });
    });

    it('소급 입력은 현재 위치를 덮어쓰지 않는다 — 어제 기록이 오늘 위치를 밀어내면 차를 못 찾는다', async () => {
        seedLogs(
            [{ id: 'B', timestamp: d(15), startKm: 60200, endKm: 60250 }],
            [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 60250, currentSiteId: 'site_b' } }],
        );

        await (onDriveLogCreated as unknown as Function)(makeEvent({
            organizationId: ORG, vehicleId: VEH, timestamp: d(10),
            startKm: 60123, endKm: 60200, distance: 77, isRetroactive: true, endSiteId: 'site_a',
        }));

        expect(vehicleSitePatches()).toHaveLength(0);
        expect(db.__get('vehicles', VEH)).toMatchObject({ currentSiteId: 'site_b' });
    });

    it('차량이 다른 기관 소속이면 갱신하지 않는다 (교차 테넌트 오염 차단)', async () => {
        seedLogs([], [{ id: VEH, col: 'vehicles', data: { organizationId: 'other-org', currentKm: 1000 } }]);

        await (onDriveLogCreated as unknown as Function)(makeEvent({
            organizationId: ORG, vehicleId: VEH, timestamp: d(20),
            startKm: 1000, endKm: 1050, distance: 50, endSiteId: 'site_a',
        }));

        expect(vehicleSitePatches()).toHaveLength(0);
    });

    it('세운 곳이 없으면 아무것도 하지 않는다 — 고정 출발지 차량이 타는 경로다', async () => {
        seedLogs([], [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 1000 } }]);

        await (onDriveLogCreated as unknown as Function)(makeEvent({
            organizationId: ORG, vehicleId: VEH, timestamp: d(20),
            startKm: 1000, endKm: 1050, distance: 50,
        }));

        expect(vehicleSitePatches()).toHaveLength(0);
    });

    it('관리자가 방금 손으로 고친 위치는 그보다 과거의 운행이 되돌리지 않는다', async () => {
        // 관리자가 15:00에 차를 옮기고 현재 위치를 고쳤는데, 16:00에 누군가 09~10시 운행을
        // 뒤늦게 적는 상황. 그 일지 뒤에는 아무 기록도 없어 소급으로 판정되지 않는다.
        seedLogs([], [{
            id: VEH, col: 'vehicles',
            data: { organizationId: ORG, currentKm: 1000, currentSiteId: 'site_b', currentSiteUpdatedAt: d(21) },
        }]);

        await (onDriveLogCreated as unknown as Function)(makeEvent({
            organizationId: ORG, vehicleId: VEH, timestamp: d(20),
            startKm: 1000, endKm: 1050, distance: 50, endSiteId: 'site_a',
        }));

        expect(vehicleSitePatches()).toHaveLength(0);
        expect(db.__get('vehicles', VEH)).toMatchObject({ currentSiteId: 'site_b' });
    });

    it('위치 갱신이 터져도 차량 누적 km 갱신은 그대로 진행된다', async () => {
        // 두 트리거는 retry: false라 한 번 던지면 이벤트가 사라진다. 수정 경로에서는 위치 갱신이
        // km 블록보다 **먼저** 도므로, 표시용 실패가 바깥으로 올라가면 회계가 통째로 유실된다.
        // 위치는 다음 운행이 다시 맞춰 주지만 currentKm은 스스로 복구되지 않는다.
        const explodingTimestamp = { toDate: () => { throw new Error('UNAVAILABLE'); } };
        seedLogs(
            [{ id: 'B', timestamp: d(20), startKm: 1000, endKm: 1060 }],
            [{
                id: VEH, col: 'vehicles',
                data: { organizationId: ORG, currentKm: 1050, currentSiteId: 'site_a', currentSiteUpdatedAt: explodingTimestamp },
            }],
        );

        await (onDriveLogUpdated as unknown as Function)(makeUpdateEvent(
            { organizationId: ORG, vehicleId: VEH, timestamp: d(20), startKm: 1000, endKm: 1050, endSiteId: 'site_a' },
            { organizationId: ORG, vehicleId: VEH, timestamp: d(20), startKm: 1000, endKm: 1060, endSiteId: 'site_b' },
        ));

        // 위치는 못 옮겼지만(예외) 누적 km 차분 +10은 반영됐다
        expect(vehicleSitePatches()).toHaveLength(0);
        const kmPatches = db.__updates()
            .filter((u: { col: string; patch: Record<string, unknown> }) => u.col === 'vehicles' && 'currentKm' in u.patch)
            .map((u: { patch: Record<string, unknown> }) => u.patch);
        expect(kmPatches).toEqual([{ currentKm: { __increment: 10 } }]);
    });

    it('수정으로 세운 곳이 바뀌면 현재 위치를 다시 맞춘다', async () => {
        seedLogs(
            [{ id: 'B', timestamp: d(20), startKm: 1000, endKm: 1050 }],
            [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 1050, currentSiteId: 'site_a' } }],
        );

        await (onDriveLogUpdated as unknown as Function)(makeUpdateEvent(
            { organizationId: ORG, vehicleId: VEH, timestamp: d(20), startKm: 1000, endKm: 1050, endSiteId: 'site_a' },
            { organizationId: ORG, vehicleId: VEH, timestamp: d(20), startKm: 1000, endKm: 1050, endSiteId: 'site_b' },
        ));

        expect(vehicleSitePatches()).toEqual([{ currentSiteId: 'site_b', currentSiteUpdatedAt: 'SERVER_TS' }]);
    });

    it('세운 곳이 그대로인 수정은 확인 시각을 건드리지 않는다 — 매 수정마다 갱신하면 신선도 표기가 거짓말이 된다', async () => {
        seedLogs(
            [{ id: 'B', timestamp: d(20), startKm: 1000, endKm: 1060 }],
            [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 1060, currentSiteId: 'site_a' } }],
        );

        await (onDriveLogUpdated as unknown as Function)(makeUpdateEvent(
            { organizationId: ORG, vehicleId: VEH, timestamp: d(20), startKm: 1000, endKm: 1050, endSiteId: 'site_a' },
            { organizationId: ORG, vehicleId: VEH, timestamp: d(20), startKm: 1000, endKm: 1060, endSiteId: 'site_a' },
        ));

        expect(vehicleSitePatches()).toHaveLength(0);
    });
});

describe('onDriveLogDeleted — 중간 기록 삭제 후 재정합', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('중간 기록을 지우면 뒤 기록을 앞으로 당기고 차량 currentKm도 같은 폭으로 줄인다', async () => {
        // A(100→150) [삭제된 R 150→180] C(180→230) → C는 A의 endKm(150)부터 재정합되어 150→200
        seedLogs(
            [
                { id: 'A', timestamp: d(5), startKm: 100, endKm: 150 },
                { id: 'C', timestamp: d(20), startKm: 180, endKm: 230 },
            ],
            [{ id: VEH, col: 'vehicles', data: { organizationId: ORG, currentKm: 230 } }],
        );

        await (onDriveLogDeleted as unknown as Function)({
            data: {
                data: () => ({
                    organizationId: ORG, vehicleId: VEH, timestamp: d(10),
                    startKm: 150, endKm: 180, distance: 30,
                }),
            },
            params: { logId: 'R' },
        });

        expect(db.__get('driveLogs', 'C')).toMatchObject({ startKm: 150, endKm: 200 }); // 거리 50 보존
        const vehUpdates = db.__updates().filter((u: { col: string }) => u.col === 'vehicles');
        expect(vehUpdates).toHaveLength(1);
        expect(vehUpdates[0].patch).toEqual({ currentKm: { __increment: -30 } });
    });
});
