/**
 * batchStep.test.ts — 야간·주간 배치가 공유하는 스텝 래퍼 단위 테스트
 *
 * 세 배치(dailyNightlyBatch·nightlyStatsBatch·weeklyMaintenanceBatch)가 같은 실패 처리 규약을
 * 여기에 의존한다. 지키려는 것은 둘이다:
 *   1. 스텝이 실패해도 배치가 멈추지 않되 **조용히 넘어가지 않는다**(captureError로 승격)
 *   2. 그렇게 올린 보고가 **실제로 전송된다**(종료 시 flush)
 *
 * 2번이 핵심이다. Sentry 전송은 비동기라 핸들러가 반환하면 Cloud Run 인스턴스가 동결되며
 * 버퍼가 사라지는데, 스케줄 함수에는 경계에서 flush해 주는 래퍼가 없다. flush를 빠뜨려도
 * 코드는 멀쩡해 보이고 테스트도 통과하므로 — 백업 실패 알림이 사라진 뒤에야 드러난다 —
 * 여기서 고정한다.
 */

const mockCaptureError = jest.fn();
const mockFlushSentry = jest.fn();
jest.mock('../core/sentry', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
    flushSentry: (...args: unknown[]) => mockFlushSentry(...args),
}));

import { runStep, logBatchResult } from '../utils/batchStep';

describe('batchStep', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        console.error = jest.fn();
        console.log = jest.fn();
        mockFlushSentry.mockResolvedValue(undefined);
    });

    describe('runStep()', () => {
        it('성공하면 실패 목록을 건드리지 않고 보고도 하지 않는다', async () => {
            const failed: string[] = [];

            await runStep(failed, 'nightly', 'backupFirestore', async () => undefined);

            expect(failed).toEqual([]);
            expect(mockCaptureError).not.toHaveBeenCalled();
        });

        it('실패하면 삼키지 않고 captureError로 올린 뒤 실패 목록에 담는다', async () => {
            const failed: string[] = [];
            const err = new Error('백업 버킷 접근 거부');

            await runStep(failed, 'nightly', 'backupFirestore', async () => { throw err; });

            expect(failed).toEqual(['backupFirestore']);
            expect(mockCaptureError).toHaveBeenCalledWith(err, { context: 'nightly', step: 'backupFirestore' });
        });

        it('실패해도 던지지 않는다 — 다음 스텝이 계속 돌아야 한다', async () => {
            const failed: string[] = [];

            await expect(
                runStep(failed, 'nightly', 'checkInsuranceExpiry', async () => { throw new Error('boom'); })
            ).resolves.toBeUndefined();
        });
    });

    describe('logBatchResult()', () => {
        it('실패가 없어도 flush한다 — 스텝 밖에서 올라온 보고가 있을 수 있다', async () => {
            await logBatchResult('nightly', []);

            expect(mockFlushSentry).toHaveBeenCalledTimes(1);
        });

        it('실패가 있으면 error 로그를 남기고 flush한다', async () => {
            await logBatchResult('nightly', ['backupFirestore', 'checkInsuranceExpiry']);

            expect(console.error).toHaveBeenCalledWith(
                expect.stringContaining('2 failed step(s): backupFirestore, checkInsuranceExpiry')
            );
            expect(mockFlushSentry).toHaveBeenCalledTimes(1);
        });

        it('flush가 끝나기 전에 반환하지 않는다', async () => {
            let flushed = false;
            mockFlushSentry.mockImplementation(
                () => new Promise<void>(resolve => setTimeout(() => { flushed = true; resolve(); }, 10))
            );

            await logBatchResult('nightly', []);

            // await 없이 반환하면 여기서 false다 — 인스턴스가 동결되며 버퍼가 사라지는 형태
            expect(flushed).toBe(true);
        });
    });
});
