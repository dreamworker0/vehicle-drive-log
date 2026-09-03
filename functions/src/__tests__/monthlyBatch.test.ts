/**
 * monthlyBatch.test.ts — 월배치의 **보고 전송 경계** 단위 테스트
 *
 * 단계별 로직은 각자의 테스트가 있고, 여기서 지키려는 것은 하나다:
 * 두 단계가 남긴 captureError/captureWarning이 실제로 Sentry까지 가는가.
 *
 * Sentry 전송은 비동기라 핸들러가 반환하면 Cloud Run 인스턴스가 동결·종료되면서 버퍼가
 * 사라진다. HTTPS·콜러블은 wrapHttps·wrapCallableHandler가 경계에서 flush하지만 스케줄
 * 함수에는 그 래퍼가 없다. flush를 빠뜨리면 "실패를 보고한다"가 조용히 무효가 되는데,
 * 그건 코드를 읽어서는 드러나지 않으므로 테스트로 고정한다.
 */

// onSchedule을 걷어내고 핸들러 함수만 꺼낸다
let capturedHandler: (() => Promise<void>) | null = null;
jest.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (_opts: unknown, handler: () => Promise<void>) => {
        capturedHandler = handler;
        return handler;
    },
}));

const mockSyncHolidays = jest.fn();
const mockVerifyMileage = jest.fn();
jest.mock('../handlers/scheduled/syncHolidays', () => ({
    syncHolidays: (...args: unknown[]) => mockSyncHolidays(...args),
}));
jest.mock('../handlers/scheduled/verifyMileageConsistency', () => ({
    verifyMileageConsistency: (...args: unknown[]) => mockVerifyMileage(...args),
}));

const mockFlushSentry = jest.fn();
jest.mock('../core/sentry', () => ({
    flushSentry: (...args: unknown[]) => mockFlushSentry(...args),
}));

import '../handlers/scheduled/monthlyBatch';

describe('monthlyBatch — 보고 전송 경계', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        console.error = jest.fn();
        console.log = jest.fn();
        mockSyncHolidays.mockResolvedValue(undefined);
        mockVerifyMileage.mockResolvedValue(undefined);
        mockFlushSentry.mockResolvedValue(undefined);
    });

    it('모든 단계가 끝난 뒤 Sentry를 flush한다', async () => {
        await capturedHandler!();

        expect(mockSyncHolidays).toHaveBeenCalledTimes(1);
        expect(mockVerifyMileage).toHaveBeenCalledTimes(1);
        expect(mockFlushSentry).toHaveBeenCalledTimes(1);
    });

    it('단계가 던져도 flush는 반드시 부른다 — 그때가 보고할 것이 가장 많은 때다', async () => {
        mockSyncHolidays.mockRejectedValue(new Error('공휴일 API 응답 없음'));
        mockVerifyMileage.mockRejectedValue(new Error('마일리지 검증 실패'));

        await capturedHandler!();

        // 단계 실패가 다른 단계나 flush를 막지 않는다(각 단계는 독립 try/catch)
        expect(mockVerifyMileage).toHaveBeenCalledTimes(1);
        expect(mockFlushSentry).toHaveBeenCalledTimes(1);
    });
});
