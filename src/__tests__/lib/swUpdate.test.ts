/**
 * SW 업데이트 체크의 거부가 새지 않는지 고정한다.
 *
 * `registration.update()`는 SW 스크립트를 다시 받아 파싱하므로 모바일 회선에서 전송이 잘리면
 * 거부된다(iOS Safari: `TypeError: SyntaxError: Unexpected end of script`). 받아 주는 곳이
 * 없으면 unhandledrejection으로 새어 앱 버그처럼 Sentry에 올라왔다
 * (JAVASCRIPT-REACT-63, /employee/today). UpdatePrompt의 주기 체크·탭 복귀 체크가
 * 모두 이 함수를 지나므로 여기 한 곳에서 고정한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkForSwUpdate } from '../../lib/swUpdate';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('checkForSwUpdate', () => {
    it('전송이 잘려 거부되어도 삼키고, 이유를 콘솔에 남긴다', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => { });
        // iOS Safari가 잘린 스크립트에 대해 내는 거부
        const err = new TypeError('SyntaxError: Unexpected end of script');
        const registration = {
            update: vi.fn().mockRejectedValue(err),
        } as unknown as ServiceWorkerRegistration;

        // 던지지 않아야 한다 (동기 throw도, 처리되지 않은 거부도 없어야 한다)
        expect(() => checkForSwUpdate(registration)).not.toThrow();
        await Promise.resolve();
        await Promise.resolve();

        expect(debugSpy).toHaveBeenCalledWith(
            expect.stringContaining('SW 업데이트 체크 실패'),
            err,
        );
    });

    it('정상 갱신은 조용히 지나간다', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => { });
        const registration = {
            update: vi.fn().mockResolvedValue(undefined),
        } as unknown as ServiceWorkerRegistration;

        checkForSwUpdate(registration);
        await Promise.resolve();
        await Promise.resolve();

        expect(registration.update).toHaveBeenCalledTimes(1);
        expect(debugSpy).not.toHaveBeenCalled();
    });
});
