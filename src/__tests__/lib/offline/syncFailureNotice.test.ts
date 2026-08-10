/**
 * syncFailureNotice — 오프라인 큐에서 폐기된 기록의 사용자 안내
 *
 * 큐(syncQueue)와 토스트(notify)는 목으로 대체하고, "폐기분을 빠짐없이·중복 없이 알리는가"만 검증한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/offline/syncQueue', () => ({
    drainFailedRecords: vi.fn(),
    flushQueue: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/notify', () => ({ notifyUser: vi.fn() }));

import { buildFailureMessage, reportFailedSync } from '@/lib/offline/syncFailureNotice';
import { drainFailedRecords, type FailedRecord } from '@/lib/offline/syncQueue';
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
