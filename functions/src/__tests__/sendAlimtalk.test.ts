/**
 * sendAlimtalk.test.ts — Cafe24 프록시 경유 알림톡 발송 헬퍼
 *
 * 알리고 템플릿은 본문·버튼이 등록된 내용과 한 글자라도 다르면 발송이 거부된다.
 * 그래서 "무엇을 프록시에 싣는가"(템플릿 코드·수신번호 정리·버튼 고정 URL)와
 * "실패를 어떻게 돌려주는가"(환경변수 누락·응답 실패·네트워크 예외)를 고정한다.
 * 로그 출력 자체는 단언하지 않는다 — 로거 교체(console → logger)와 무관하게 유지되도록.
 */
import {
    sendApprovalAlimtalk,
    sendReminderAlimtalk,
    sendRejectionAlimtalk,
} from '../services/alimtalk/sendAlimtalk';

const PROXY_URL = 'https://proxy.test/alimtalk.php';
const PROXY_TOKEN = 'proxy-token-test';
const SERVICE_URL = 'https://vehicle-drive-log.web.app';

const mockFetch = jest.fn();

/** fetch에 넘긴 본문의 aligo_params를 꺼낸다 */
function sentParams(callIndex = 0): Record<string, string> {
    const [, init] = mockFetch.mock.calls[callIndex];
    return JSON.parse(init.body).aligo_params;
}

function jsonResponse(body: unknown) {
    return { json: () => Promise.resolve(body) };
}

describe('sendAlimtalk', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        mockFetch.mockReset();
        global.fetch = mockFetch as unknown as typeof fetch;
        process.env.ALIMTALK_PROXY_URL = PROXY_URL;
        process.env.ALIMTALK_PROXY_TOKEN = PROXY_TOKEN;
        // 로그는 조용히만 — 출력 내용은 단언하지 않는다
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.restoreAllMocks();
    });

    // 세 함수가 공유하는 실패 계약 — 환경변수 누락·응답 실패·네트워크 예외
    const senders: Array<[string, () => ReturnType<typeof sendApprovalAlimtalk>]> = [
        ['sendApprovalAlimtalk', () => sendApprovalAlimtalk('010-1234-5678', '홍길동', '행복복지관', 'ABC123')],
        ['sendReminderAlimtalk', () => sendReminderAlimtalk('010-1234-5678', '홍길동', '행복복지관', 'ABC123')],
        ['sendRejectionAlimtalk', () => sendRejectionAlimtalk('010-1234-5678', '홍길동', '행복복지관', '2026-11-01', '서류 미비')],
    ];

    describe.each(senders)('%s 공통 실패 경로', (_name, send) => {
        it('프록시 URL이 없으면 호출하지 않고 실패를 돌려준다', async () => {
            delete process.env.ALIMTALK_PROXY_URL;

            const result = await send();

            expect(result).toEqual({ success: false, message: '프록시 환경변수 미설정' });
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('프록시 토큰이 없으면 호출하지 않고 실패를 돌려준다', async () => {
            delete process.env.ALIMTALK_PROXY_TOKEN;

            const result = await send();

            expect(result.success).toBe(false);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('프록시 응답을 그대로 돌려준다 (성공)', async () => {
            mockFetch.mockResolvedValue(jsonResponse({ success: true, code: 0, message: 'ok' }));

            await expect(send()).resolves.toEqual({ success: true, code: 0, message: 'ok' });
        });

        it('프록시가 실패를 알리면 그 코드·메시지를 그대로 돌려준다 (예외로 바꾸지 않는다)', async () => {
            mockFetch.mockResolvedValue(jsonResponse({ success: false, code: -99, message: '템플릿 불일치' }));

            await expect(send()).resolves.toEqual({ success: false, code: -99, message: '템플릿 불일치' });
        });

        it('네트워크 예외는 던지지 않고 실패 결과로 바꾼다', async () => {
            mockFetch.mockRejectedValue(new Error('ECONNRESET'));

            await expect(send()).resolves.toEqual({ success: false, message: 'ECONNRESET' });
        });

        it('응답이 JSON이 아니어도(프록시 HTML 오류 페이지) 실패 결과로 바꾼다', async () => {
            mockFetch.mockResolvedValue({ json: () => Promise.reject(new Error('Unexpected token <')) });

            await expect(send()).resolves.toEqual({ success: false, message: 'Unexpected token <' });
        });

        it('프록시 토큰을 X-API-Token 헤더로 POST한다', async () => {
            mockFetch.mockResolvedValue(jsonResponse({ success: true }));

            await send();

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const [url, init] = mockFetch.mock.calls[0];
            expect(url).toBe(PROXY_URL);
            expect(init.method).toBe('POST');
            expect(init.headers).toEqual({
                'Content-Type': 'application/json',
                'X-API-Token': PROXY_TOKEN,
            });
        });
    });

    describe('sendApprovalAlimtalk', () => {
        beforeEach(() => {
            mockFetch.mockResolvedValue(jsonResponse({ success: true }));
        });

        it('승인 템플릿(UG_2592)으로 하이픈을 뺀 번호에 보낸다', async () => {
            await sendApprovalAlimtalk('010-1234-5678', '홍길동', '행복복지관', 'ABC123');

            const p = sentParams();
            expect(p.tpl_code).toBe('UG_2592');
            expect(p.receiver_1).toBe('01012345678');
            expect(p.recvname_1).toBe('홍길동');
            expect(p.subject_1).toBe('차량 운행일지');
            expect(p.emtitle_1).toBe('기관 신청이 승인됐습니다.');
        });

        it('본문에 초대 코드와 코드가 붙은 서비스 링크를 LF 줄바꿈으로 싣는다', async () => {
            await sendApprovalAlimtalk('01012345678', '홍길동', '행복복지관', 'ABC123');

            const msg = sentParams().message_1;
            expect(msg.split('\n')[0]).toBe('안녕하세요. 홍길동님!');
            expect(msg).toContain('행복복지관에서 신청해주셔서 감사합니다.');
            expect(msg).toContain(`서비스 링크 : ${SERVICE_URL}?code=ABC123`);
            expect(msg).toContain('초대 코드 : ABC123');
            expect(msg).not.toContain('\r');
        });

        it('버튼은 템플릿에 등록된 고정 URL만 쓴다 — 쿼리를 붙이면 템플릿 불일치로 거부된다', async () => {
            await sendApprovalAlimtalk('01012345678', '홍길동', '행복복지관', 'ABC123');

            const button = JSON.parse(sentParams().button_1);
            expect(button.button).toEqual([{
                name: '차량 운행일지 서비스링크',
                linkType: 'WL',
                linkM: SERVICE_URL,
                linkP: SERVICE_URL,
            }]);
        });
    });

    describe('sendReminderAlimtalk', () => {
        beforeEach(() => {
            mockFetch.mockResolvedValue(jsonResponse({ success: true }));
        });

        it('리마인드 템플릿(UG_2597)과 고정 버튼으로 보낸다', async () => {
            await sendReminderAlimtalk('010-9999-8888', '김담당', '희망센터', 'XYZ789');

            const p = sentParams();
            expect(p.tpl_code).toBe('UG_2597');
            expect(p.receiver_1).toBe('01099998888');
            expect(p.emtitle_1).toBe('기관 관리자 등록해주세요.');
            expect(JSON.parse(p.button_1).button[0].linkM).toBe(SERVICE_URL);
        });

        it('본문에 기관명·초대 코드·코드가 붙은 링크를 싣는다', async () => {
            await sendReminderAlimtalk('01099998888', '김담당', '희망센터', 'XYZ789');

            const msg = sentParams().message_1;
            expect(msg).toContain('희망센터의 관리자로 등록해주세요.');
            expect(msg).toContain(`서비스 링크 : ${SERVICE_URL}?code=XYZ789`);
            expect(msg).toContain('초대 코드 : XYZ789');
        });
    });

    describe('sendRejectionAlimtalk', () => {
        beforeEach(() => {
            mockFetch.mockResolvedValue(jsonResponse({ success: true }));
        });

        it('반려 템플릿(UI_6491)으로 보내고 버튼은 싣지 않는다 — 버튼 없는 템플릿', async () => {
            await sendRejectionAlimtalk('010-1111-2222', '이신청', '사랑의집', '2026-11-01', '고유번호증 불일치');

            const p = sentParams();
            expect(p.tpl_code).toBe('UI_6491');
            expect(p.receiver_1).toBe('01011112222');
            expect(p.emtitle_1).toBe('기관 신청 결과 안내');
            expect(p).not.toHaveProperty('button_1');
        });

        it('본문 마지막 줄이 반려 사유다 — 템플릿 변수 순서를 지킨다', async () => {
            await sendRejectionAlimtalk('01011112222', '이신청', '사랑의집', '2026-11-01', '고유번호증 불일치');

            const lines = sentParams().message_1.split('\n');
            expect(lines[0]).toBe('안녕하세요, 이신청님.');
            expect(lines).toContain('■ 신청 기관: 사랑의집');
            expect(lines).toContain('■ 신청 일자: 2026-11-01');
            expect(lines[lines.length - 2]).toBe('■ 반려 사유:');
            expect(lines[lines.length - 1]).toBe('고유번호증 불일치');
        });
    });
});
