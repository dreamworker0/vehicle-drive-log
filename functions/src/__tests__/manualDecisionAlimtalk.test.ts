/**
 * manualDecisionAlimtalk.test.ts — 수동 승인·반려 알림톡(sendManualApprovalAlimtalk·sendManualRejectionAlimtalk)
 * - 지키는 것: superAdmin만, 기관 ID·문서 확인(공통 헬퍼 loadOrgForManualAlimtalk는 실제 코드),
 *   전화번호·초대 코드가 없으면 발송하지 않고 이유를 돌려줌, 수신자 이름은 신청자명 → 기관명,
 *   반려는 신청일(KST)과 사유(없으면 안내 문구)를 담는다
 */

const mockOrgGet = jest.fn();
const mockDoc = jest.fn((_path: string) => ({ get: mockOrgGet }));
const mockSendApprovalAlimtalk = jest.fn();
const mockSendRejectionAlimtalk = jest.fn();

jest.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ doc: mockDoc }) }));
jest.mock('../services/alimtalk/sendAlimtalk', () => ({
    sendApprovalAlimtalk: (...args: unknown[]) => mockSendApprovalAlimtalk(...args),
    sendRejectionAlimtalk: (...args: unknown[]) => mockSendRejectionAlimtalk(...args),
}));
jest.mock('../core/params', () => ({ ALIMTALK_PROXY_TOKEN: {} }));
jest.mock('../core/sentry', () => ({ captureError: jest.fn(), flushSentry: jest.fn() }));
jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }));
jest.mock('firebase-functions/v2/https', () => ({
    onCall: (_opts: unknown, handler: (req: unknown) => unknown) => handler,
    HttpsError: class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
}));

import { sendManualApprovalAlimtalk } from '../handlers/callable/sendManualApprovalAlimtalk';
import { sendManualRejectionAlimtalk } from '../handlers/callable/sendManualRejectionAlimtalk';

type Handler = (req: Record<string, unknown>) => Promise<{ success: boolean; message?: string }>;
const approval = sendManualApprovalAlimtalk as unknown as Handler;
const rejection = sendManualRejectionAlimtalk as unknown as Handler;
const superAdmin = { uid: 'sa1', token: { role: 'superAdmin' } };
const org = (data: Record<string, unknown> | null) =>
    mockOrgGet.mockResolvedValueOnce({ exists: data !== null, data: () => data ?? undefined });
const base = { name: '행복복지관', applicantName: '홍길동', applicantPhone: '01012345678', inviteCode: 'AB12CD' };

describe.each([
    ['승인', approval, mockSendApprovalAlimtalk],
    ['반려', rejection, mockSendRejectionAlimtalk],
])('수동 %s 알림톡 — 공통', (_label, handler, sendMock) => {
    beforeEach(() => {
        jest.clearAllMocks();
        sendMock.mockResolvedValue({ success: true, message: '발송 완료' });
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    it('superAdmin이 아니면 기관 문서도 읽지 않고 거부한다', async () => {
        await expect(handler({ auth: null, data: { orgId: 'org1' } })).rejects.toMatchObject({ code: 'unauthenticated' });
        await expect(handler({ auth: { uid: 'a1', token: { role: 'admin' } }, data: { orgId: 'org1' } }))
            .rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockOrgGet).not.toHaveBeenCalled();
    });

    it('기관 ID가 없으면 거부한다', async () => {
        await expect(handler({ auth: superAdmin, data: {} })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('기관이 없으면 not-found', async () => {
        org(null);
        await expect(handler({ auth: superAdmin, data: { orgId: 'org1' } })).rejects.toMatchObject({ code: 'not-found' });
        expect(mockDoc).toHaveBeenCalledWith('organizations/org1');
    });

    it('전화번호가 없으면 보내지 않고 이유를 돌려준다', async () => {
        org({ ...base, applicantPhone: '' });
        await expect(handler({ auth: superAdmin, data: { orgId: 'org1' } }))
            .resolves.toEqual({ success: false, message: '신청자 전화번호가 없습니다.' });
        expect(sendMock).not.toHaveBeenCalled();
    });

    it('발송 결과(실패 포함)를 그대로 돌려준다', async () => {
        org(base);
        sendMock.mockResolvedValueOnce({ success: false, message: '프록시 오류' });
        await expect(handler({ auth: superAdmin, data: { orgId: 'org1' } }))
            .resolves.toEqual({ success: false, message: '프록시 오류' });
    });
});

describe('sendManualApprovalAlimtalk', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSendApprovalAlimtalk.mockResolvedValue({ success: true, message: '발송 완료' });
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    it('신청자에게 이름·기관명·초대 코드로 보낸다', async () => {
        org(base);
        await expect(approval({ auth: superAdmin, data: { orgId: 'org1' } })).resolves.toEqual({ success: true, message: '발송 완료' });
        expect(mockSendApprovalAlimtalk).toHaveBeenCalledWith('01012345678', '홍길동', '행복복지관', 'AB12CD');
    });

    it('신청자 이름이 없으면 기관명으로 부른다', async () => {
        org({ ...base, applicantName: '' });
        await approval({ auth: superAdmin, data: { orgId: 'org1' } });
        expect(mockSendApprovalAlimtalk.mock.calls[0][1]).toBe('행복복지관');
    });

    it('초대 코드가 없으면 보내지 않는다 — 코드 없는 승인 안내는 가입할 수 없다', async () => {
        org({ ...base, inviteCode: '' });
        await expect(approval({ auth: superAdmin, data: { orgId: 'org1' } }))
            .resolves.toEqual({ success: false, message: '초대코드가 없습니다.' });
        expect(mockSendApprovalAlimtalk).not.toHaveBeenCalled();
    });
});

describe('sendManualRejectionAlimtalk', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSendRejectionAlimtalk.mockResolvedValue({ success: true, message: '발송 완료' });
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    it('신청일(KST)과 사유를 담아 보낸다', async () => {
        // 2026-10-15 23:30 KST = 14:30 UTC — UTC 날짜로 찍으면 하루가 어긋난다
        org({ ...base, createdAt: { toDate: () => new Date('2026-10-15T14:30:00Z') } });
        await rejection({ auth: superAdmin, data: { orgId: 'org1', reason: '고유번호증 확인 불가' } });
        expect(mockSendRejectionAlimtalk).toHaveBeenCalledWith('01012345678', '홍길동', '행복복지관', '2026-10-15', '고유번호증 확인 불가');
    });

    it('사유가 없으면 이메일 확인 안내를 넣는다', async () => {
        org({ ...base, createdAt: { toDate: () => new Date('2026-10-01T00:00:00Z') } });
        await rejection({ auth: superAdmin, data: { orgId: 'org1' } });
        expect(mockSendRejectionAlimtalk.mock.calls[0][4]).toBe('자세한 사유는 안내 이메일을 확인해 주세요.');
    });

    it('신청 시각이 없으면 오늘 날짜로 보낸다', async () => {
        org(base);
        await rejection({ auth: superAdmin, data: { orgId: 'org1' } });
        expect(mockSendRejectionAlimtalk.mock.calls[0][3]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});
