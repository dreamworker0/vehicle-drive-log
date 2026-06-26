/**
 * adjustAdjacentLogs — 수정 모드 인접 기록 km 자동 조정
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdateDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
    doc: (...args: unknown[]) => ({ __doc: args }),
    updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
    serverTimestamp: () => ({ __ts: true }),
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));

import { adjustAdjacentLogs } from '../../hooks/driveLogForm/adjustAdjacentLogs';
import type { DriveLog } from '../../types/driveLog';

const log = (id: string, startKm: number, endKm: number) =>
    ({ id, startKm, endKm } as unknown as DriveLog);

beforeEach(() => {
    mockUpdateDoc.mockReset();
    mockUpdateDoc.mockResolvedValue(undefined);
});

describe('adjustAdjacentLogs', () => {
    it('인접 기록이 없으면 아무 것도 하지 않고 빈 배열', async () => {
        const msgs = await adjustAdjacentLogs({ lastDriveLog: null, nextDriveLog: null, startKm: 100, endKm: 200 });
        expect(msgs).toEqual([]);
        expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it('직전 기록 endKm이 현재 startKm과 다르면 조정한다', async () => {
        const msgs = await adjustAdjacentLogs({ lastDriveLog: log('a', 50, 90), nextDriveLog: null, startKm: 100, endKm: 200 });
        expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
        expect(mockUpdateDoc.mock.calls[0][1]).toMatchObject({ endKm: 100 });
        expect(msgs[0]).toContain('직전 기록 도착 km');
    });

    it('직후 기록 startKm이 현재 endKm과 다르면 조정한다', async () => {
        const msgs = await adjustAdjacentLogs({ lastDriveLog: null, nextDriveLog: log('b', 250, 300), startKm: 100, endKm: 200 });
        expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
        expect(mockUpdateDoc.mock.calls[0][1]).toMatchObject({ startKm: 200 });
        expect(msgs[0]).toContain('직후 기록 출발 km');
    });

    it('이미 일치하면 조정하지 않는다', async () => {
        const msgs = await adjustAdjacentLogs({ lastDriveLog: log('a', 50, 100), nextDriveLog: log('b', 200, 300), startKm: 100, endKm: 200 });
        expect(mockUpdateDoc).not.toHaveBeenCalled();
        expect(msgs).toEqual([]);
    });

    it('updateDoc 실패는 삼키고 해당 메시지만 누락한다(본 저장 보호)', async () => {
        mockUpdateDoc.mockRejectedValueOnce(new Error('network'));
        const msgs = await adjustAdjacentLogs({ lastDriveLog: log('a', 50, 90), nextDriveLog: log('b', 250, 300), startKm: 100, endKm: 200 });
        // 직전은 실패 → 메시지 없음, 직후는 성공 → 메시지 1개
        expect(msgs).toHaveLength(1);
        expect(msgs[0]).toContain('직후 기록 출발 km');
    });
});
