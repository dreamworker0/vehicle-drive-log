/**
 * syncFailureNotice — 오프라인 큐에서 폐기된 기록의 사용자 안내
 *
 * 큐(syncQueue)와 토스트(notify)는 목으로 대체하고, "폐기분을 빠짐없이·중복 없이 알리는가"만 검증한다.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('@/lib/offline/syncQueue', () => ({
    peekFailedRecords: vi.fn(),
    clearFailedRecords: vi.fn(),
    flushQueue: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/notify', () => ({ notifyUser: vi.fn() }));

import { buildFailureMessage, reportFailedSync, registerSyncFailureNotice, describeRecord } from '@/lib/offline/syncFailureNotice';
import { peekFailedRecords, clearFailedRecords, flushQueue, type FailedRecord } from '@/lib/offline/syncQueue';
import { notifyUser } from '@/lib/notify';

const mockDrain = vi.mocked(peekFailedRecords);
const mockClear = vi.mocked(clearFailedRecords);
const mockNotify = vi.mocked(notifyUser);

function record(over: Partial<FailedRecord> = {}): FailedRecord {
    return {
        type: 'UPDATE',
        collection: 'driveLogs',
        docId: 'a',
        data: {},
        timestamp: 1,
        failedAt: 2,
        reason: 'retry-exhausted',
        code: '',
        ...over,
    };
}

describe('buildFailureMessage', () => {
    it('컬렉션별 건수를 사람이 읽는 이름으로 합산한다', () => {
        const msg = buildFailureMessage([
            record({ collection: 'driveLogs', docId: 'a' }),
            record({ collection: 'driveLogs', docId: 'b' }),
            record({ collection: 'reservations', docId: 'c' }),
        ]);
        expect(msg).toContain('운행일지 2건');
        expect(msg).toContain('예약 1건');
    });

    it('영구 오류가 섞이면 권한/변경 사유로 안내한다', () => {
        const msg = buildFailureMessage([record({ reason: 'permanent', code: 'permission-denied' })]);
        expect(msg).toContain('권한이 없거나 이미 변경된 기록이라');
    });

    it('통신 재시도 소진만 있으면 통신 오류로 안내한다', () => {
        expect(buildFailureMessage([record({ reason: 'retry-exhausted' })])).toContain('통신 오류가 반복되어');
    });

    it('무엇을 해야 하는지(재입력)를 반드시 말한다', () => {
        expect(buildFailureMessage([record()])).toContain('다시 입력');
    });
});

describe('reportFailedSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('폐기 기록이 있으면 오류 토스트로 알린다', async () => {
        mockDrain.mockResolvedValueOnce([record()]);

        const count = await reportFailedSync();

        expect(count).toBe(1);
        expect(mockNotify).toHaveBeenCalledTimes(1);
        expect(mockNotify.mock.calls[0][1]).toBe('error');
    });

    it('폐기 기록이 없으면 아무 것도 띄우지 않는다', async () => {
        mockDrain.mockResolvedValueOnce([]);

        expect(await reportFailedSync()).toBe(0);
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('큐 접근이 실패해도 앱 흐름을 깨지 않는다', async () => {
        mockDrain.mockRejectedValueOnce(new Error('idb 접근 불가'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(await reportFailedSync()).toBe(0);
        expect(mockNotify).not.toHaveBeenCalled();
    });
});

describe('registerSyncFailureNotice', () => {
    // 등록은 모듈 스코프 플래그로 1회만 일어난다. 케이스마다 다시 등록하면 이전 등록의
    // 리스너가 window/document에 그대로 남아 호출 수가 누적되므로, **한 번만 등록하고
    // 그때 붙은 핸들러를 붙잡아 직접 호출한다.** 실제 이벤트 발화와 같은 경로다.
    const handlers = new Map<string, EventListener>();
    let windowAdd: ReturnType<typeof vi.spyOn>;
    let documentAdd: ReturnType<typeof vi.spyOn>;

    beforeAll(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mockDrain.mockResolvedValue([]);
        windowAdd = vi.spyOn(window, 'addEventListener').mockImplementation((type, handler) => {
            handlers.set(`window:${type}`, handler as EventListener);
        });
        documentAdd = vi.spyOn(document, 'addEventListener').mockImplementation((type, handler) => {
            handlers.set(`document:${type}`, handler as EventListener);
        });
        registerSyncFailureNotice();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mockDrain.mockResolvedValue([]);
        vi.mocked(flushQueue).mockResolvedValue(undefined);
    });

    const fire = (key: string) => handlers.get(key)!(new Event(key.split(':')[1]));

    it('세 시점(앱 시작·온라인 복귀·화면 복귀)에 모두 걸어 둔다', () => {
        expect(handlers.has('window:online')).toBe(true);
        expect(handlers.has('document:visibilitychange')).toBe(true);
        // 앱 시작분은 등록 시점에 이미 확인했다(beforeAll에서 1회 호출)
    });

    it('온라인 복귀 시 flush가 끝난 뒤에 확인한다', async () => {
        // flush 완료 전에 확인하면 방금 폐기될 항목을 놓친다 — 순서가 계약이다.
        let resolveFlush: () => void = () => {};
        vi.mocked(flushQueue).mockReturnValueOnce(new Promise<void>((r) => { resolveFlush = r; }));
        mockDrain.mockResolvedValueOnce([record()]);

        fire('window:online');
        expect(mockDrain).not.toHaveBeenCalled(); // flush 진행 중에는 아직 보지 않는다

        resolveFlush();
        await vi.waitFor(() => expect(mockNotify).toHaveBeenCalledTimes(1));
    });

    it('화면 복귀 시 백그라운드 중 폐기된 건을 확인한다', async () => {
        mockDrain.mockResolvedValueOnce([record()]);
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

        fire('document:visibilitychange');

        await vi.waitFor(() => expect(mockNotify).toHaveBeenCalledTimes(1));
    });

    it('화면이 가려질 때는 확인하지 않는다', () => {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

        fire('document:visibilitychange');

        expect(mockDrain).not.toHaveBeenCalled();
    });

    it('두 번 등록해도 리스너가 겹치지 않는다', () => {
        registerSyncFailureNotice(); // 두 번째 호출은 무시되어야 한다

        expect(windowAdd).not.toHaveBeenCalled();
        expect(documentAdd).not.toHaveBeenCalled();
    });
});

describe('buildFailureMessage — 잃은 내용을 실제로 실어 보낸다', () => {
    it('안내 문구에 계기판 숫자가 들어간다 — 배선까지 확인한다', () => {
        // describeRecord만 테스트하면 buildFailureMessage가 그것을 **쓰지 않아도** 통과한다.
        const msg = buildFailureMessage([
            record({ data: { date: '2026-09-05', destination: '서울역', startKm: 50000, endKm: 50050 } }),
        ]);
        expect(msg).toContain('50,000→50,050km');
        expect(msg).toContain('서울역');
    });

    it('적을 내용이 없으면 빈 괄호를 만들지 않는다', () => {
        expect(buildFailureMessage([record({ data: {} })])).not.toContain('()');
    });
});

describe('describeRecord — 다시 입력할 수 있게 무엇을 잃었는지 적는다', () => {
    it('날짜·목적지·계기판을 한 줄로 만든다', () => {
        // 차에서 내린 뒤에는 계기판 숫자를 기억으로 복원할 수 없다. 건수만 알려 주면
        // "다시 입력해 주세요"를 따를 수가 없다.
        const line = describeRecord(record({
            data: { date: '2026-09-05', destination: '서울역', startKm: 50000, endKm: 50050 },
        }));
        expect(line).toBe('2026-09-05 · 서울역 · 50,000→50,050km');
    });

    it('이틀 걸린 운행은 출발일을 쓴다', () => {
        expect(describeRecord(record({ data: { startDate: '2026-09-01', date: '2026-09-02' } })))
            .toBe('2026-09-01');
    });

    it('없는 조각은 빼고 남는 것만 잇는다', () => {
        expect(describeRecord(record({ data: { destination: '시청' } }))).toBe('시청');
    });

    it('계기판은 한쪽만 있으면 적지 않는다 — 반쪽 숫자는 오히려 헷갈린다', () => {
        expect(describeRecord(record({ data: { startKm: 100 } }))).toBe('');
    });

    it('쓸 수 있는 값이 없으면 빈 문자열 — 빈 괄호가 뜨지 않게', () => {
        expect(describeRecord(record({ data: {} }))).toBe('');
        expect(describeRecord(record({ data: undefined as never }))).toBe('');
    });
});

describe('reportFailedSync — 알린 뒤에 비운다', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('알리기 전에는 비우지 않는다 — 유실을 알리는 장치가 유실되면 안 된다', async () => {
        mockDrain.mockResolvedValueOnce([record({ data: { destination: '서울역' } })]);

        await reportFailedSync();

        expect(mockNotify).toHaveBeenCalled();
        expect(mockClear).toHaveBeenCalled();
        // 순서: 알림이 먼저, 비우기가 나중
        expect(mockNotify.mock.invocationCallOrder[0]).toBeLessThan(mockClear.mock.invocationCallOrder[0]);
    });

    it('폐기 기록이 없으면 비우지도 않는다', async () => {
        mockDrain.mockResolvedValueOnce([]);

        expect(await reportFailedSync()).toBe(0);
        expect(mockClear).not.toHaveBeenCalled();
    });
});
