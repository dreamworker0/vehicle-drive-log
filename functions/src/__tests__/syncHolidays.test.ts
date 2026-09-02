/**
 * syncHolidays.test.ts — 공휴일 동기화 배치의 **실패 보고** 단위 테스트
 *
 * 이 배치는 실패해도 기존 Firestore 문서를 지우지 않고 하트비트는 그대로 찍는다.
 * 그 설계 자체는 맞지만, 보고가 없으면 **공휴일만 낡은 채 아무도 모르는** 상태가 된다
 * (헬스체크의 스케줄러 타일은 "실행됨"이라 초록으로 남는다).
 * 그래서 여기서 검증하는 것은 "무엇을 저장하는가"가 아니라 "실패를 알리는가"다.
 */

jest.mock('firebase-functions/params', () => ({
    defineString: jest.fn(() => ({ value: jest.fn(() => 'mock-key') })),
    defineSecret: jest.fn(() => ({ value: jest.fn(() => 'mock-secret') })),
}));

// ── Firestore mock ──
const mockSet = jest.fn();
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: () => ({ doc: () => ({ set: mockSet }) }),
    }),
}));

// ── helpers mock (하트비트) ──
const mockRecordHeartbeat = jest.fn();
jest.mock('../utils/helpers', () => ({
    recordHeartbeat: (...args: unknown[]) => mockRecordHeartbeat(...args),
}));

// ── sentry mock ──
const mockCaptureError = jest.fn();
const mockCaptureWarning = jest.fn();
jest.mock('../core/sentry', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
    captureWarning: (...args: unknown[]) => mockCaptureWarning(...args),
}));

import { syncHolidays } from '../handlers/scheduled/syncHolidays';

/** 공휴일 1건이 담긴 정상 응답 본문 */
const okBody = JSON.stringify({
    response: { body: { items: { item: { isHoliday: 'Y', locdate: 20260101, dateName: '신정' } } } },
});

/** fetch 한 번의 응답을 흉내낸다 */
function resp(ok: boolean, text: string, status = ok ? 200 : 500) {
    return Promise.resolve({ ok, status, text: () => Promise.resolve(text) } as unknown as Response);
}

describe('syncHolidays — 실패 보고', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        console.error = jest.fn();
        console.log = jest.fn();
    });

    it('정상 응답이면 저장하고 아무것도 보고하지 않는다', async () => {
        global.fetch = jest.fn(() => resp(true, okBody)) as unknown as typeof fetch;

        await syncHolidays();

        expect(mockSet).toHaveBeenCalledTimes(1);
        expect(mockCaptureError).not.toHaveBeenCalled();
        expect(mockCaptureWarning).not.toHaveBeenCalled();
        expect(mockRecordHeartbeat).toHaveBeenCalledWith('syncHolidays');
    });

    it('한 해도 받지 못하면 captureError로 보고하고 Firestore는 건드리지 않는다', async () => {
        // 두 해 모두 상태 코드 에러 → holidaysData가 비어 갱신 자체를 생략하는 경로
        global.fetch = jest.fn(() => resp(false, '{}', 503)) as unknown as typeof fetch;

        await syncHolidays();

        expect(mockSet).not.toHaveBeenCalled();
        expect(mockCaptureError).toHaveBeenCalledTimes(1);
        expect(mockCaptureError.mock.calls[0][0]).toBeInstanceOf(Error);
        expect((mockCaptureError.mock.calls[0][0] as Error).message).toContain('한 해도 받지 못했다');
        // 배치는 "돌긴 돌았으므로" 하트비트는 그대로 찍힌다 — 그래서 보고가 유일한 신호다
        expect(mockRecordHeartbeat).toHaveBeenCalledWith('syncHolidays');
    });

    it('상태 코드 에러는 연도별 경고로 남긴다', async () => {
        global.fetch = jest.fn(() => resp(false, '{}', 503)) as unknown as typeof fetch;

        await syncHolidays();

        // 올해·내년 두 해 모두 실패
        expect(mockCaptureWarning).toHaveBeenCalledTimes(2);
        expect(mockCaptureWarning.mock.calls[0][0]).toContain('오류 상태로 응답');
        expect(mockCaptureWarning.mock.calls[0][1]).toMatchObject({ status: 503 });
    });

    it('JSON이 아닌 응답(XML 등)은 파싱 경고로 남긴다', async () => {
        global.fetch = jest.fn(() =>
            resp(true, '<OpenAPI_ServiceResponse><cmmMsgHeader/></OpenAPI_ServiceResponse>')
        ) as unknown as typeof fetch;

        await syncHolidays();

        expect(mockCaptureWarning).toHaveBeenCalledTimes(2);
        expect(mockCaptureWarning.mock.calls[0][0]).toContain('파싱하지 못했다');
        expect(mockSet).not.toHaveBeenCalled();
        expect(mockCaptureError).toHaveBeenCalledTimes(1);
    });

    it('한 해만 실패하면 받은 해는 저장하고 경고만 남긴다', async () => {
        let call = 0;
        global.fetch = jest.fn(() => {
            call += 1;
            return call === 1 ? resp(true, okBody) : resp(false, '{}', 500);
        }) as unknown as typeof fetch;

        await syncHolidays();

        expect(mockSet).toHaveBeenCalledTimes(1);
        expect(mockCaptureWarning).toHaveBeenCalledTimes(1);
        // 일부라도 받았으면 "전멸" 보고는 하지 않는다
        expect(mockCaptureError).not.toHaveBeenCalled();
    });

    it('fetch 자체가 던지면 captureError로 보고한다', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;

        await syncHolidays();

        expect(mockCaptureError).toHaveBeenCalledTimes(1);
        expect((mockCaptureError.mock.calls[0][0] as Error).message).toBe('network down');
        expect(mockCaptureError.mock.calls[0][1]).toMatchObject({ fn: 'syncHolidays' });
    });
});
