/**
 * syncFailureNotice — 오프라인 큐에서 폐기된 기록의 사용자 안내
 *
 * 큐(syncQueue)와 토스트(notify)는 목으로 대체하고, "폐기분을 빠짐없이·중복 없이 알리는가"만 검증한다.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('@/lib/offline/syncQueue', () => ({
    drainFailedRecords: vi.fn(),
    flushQueue: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/notify', () => ({ notifyUser: vi.fn() }));

import { buildFailureMessage, reportFailedSync, registerSyncFailureNotice } from '@/lib/offline/syncFailureNotice';
import { drainFailedRecords, flushQueue, type FailedRecord } from '@/lib/offline/syncQueue';
import { notifyUser } from '@/lib/notify';

const mockDrain = vi.mocked(drainFailedRecords);
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
