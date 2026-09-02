/**
 * sendAdminNotice.test.ts
 * - 기관 공지사항 발송 onCall 함수 단위 테스트
 * - Firestore, FCM 푸시, Rate Limit, 인앱 알림은 mock 처리
 */

// ── Rate Limit Mock ──
const mockCheckRateLimit = jest.fn().mockResolvedValue(undefined);
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByUid: mockCheckRateLimit,
}));

// ── sendNotification Mock ──
const mockSendPushToOrg = jest.fn().mockResolvedValue(undefined);
const mockCreateInAppNotificationForOrg = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/alimtalk/sendNotification', () => ({
    sendPushToOrg: mockSendPushToOrg,
    createInAppNotificationForOrg: mockCreateInAppNotificationForOrg,
}));

// ── Firestore Mock ──
const mockUserGet = jest.fn();
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn(() => ({
            doc: jest.fn(() => ({ get: mockUserGet })),
        })),
    }),
}));

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

import { sendAdminNotice } from "../handlers/callable/sendAdminNotice";

const handler = sendAdminNotice as unknown as (req: Record<string, unknown>) => Promise<unknown>;

describe('sendAdminNotice — 기관 공지 발송', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('인증이 없으면 unauthenticated 에러를 던진다', async () => {
        const req = {
            auth: null,
            data: { orgId: 'org1', title: '공지', message: '내용' },
        };
        await expect(handler(req)).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('orgId, title, message 중 하나라도 없으면 invalid-argument 에러를 던진다', async () => {
        mockCheckRateLimit.mockResolvedValue(undefined);
        mockUserGet.mockResolvedValue({
            exists: true,
            data: () => ({ role: 'admin', organizationId: 'org1', name: '관리자' }),
        });

        const req = {
            auth: { uid: 'user1', token: {} },
            data: { orgId: 'org1', title: '제목' }, // message 없음
        };
        await expect(handler(req)).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('사용자 문서가 없으면 permission-denied 에러를 던진다', async () => {
        mockCheckRateLimit.mockResolvedValue(undefined);
        mockUserGet.mockResolvedValueOnce({ exists: false });

        const req = {
            auth: { uid: 'user1', token: {} },
            data: { orgId: 'org1', title: '공지', message: '내용' },
        };
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('다른 기관에 공지를 보내면 permission-denied 에러를 던진다', async () => {
        mockCheckRateLimit.mockResolvedValue(undefined);
        mockUserGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ role: 'admin', organizationId: 'org1', name: '관리자' }),
        });

        const req = {
            auth: { uid: 'user1', token: {} },
            data: { orgId: 'org2', title: '공지', message: '내용' }, // 다른 기관
        };
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('정상 처리: 인앱 알림 + FCM 발송 후 success: true를 반환한다', async () => {
        mockCheckRateLimit.mockResolvedValue(undefined);
        mockUserGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ role: 'admin', organizationId: 'org1', name: '홍길동' }),
        });

        const req = {
            auth: { uid: 'user1', token: {} },
            data: { orgId: 'org1', title: '중요 공지', message: '오늘 회의가 있습니다.' },
        };
        const result = await handler(req);

        expect(result).toEqual({ success: true });
        expect(mockCreateInAppNotificationForOrg).toHaveBeenCalledWith(
            'org1',
            'admin_notice',
            '중요 공지',
            '홍길동: 오늘 회의가 있습니다.',
            null
        );
        expect(mockSendPushToOrg).toHaveBeenCalledWith(
            'org1',
            { title: '공지: 중요 공지', body: '오늘 회의가 있습니다.' },
            'user1'
        );
    });

    // 2026-09-02 보안 점검 — 종전 역할 목록에 employee가 들어 있어 로그인한 직원 누구나
    // 기관 전체에 FCM 푸시를 보낼 수 있었다. 화면은 관리자 전용이었지만 콜러블은 화면을 우회한다.
    it('일반 직원(employee)은 permission-denied — 기관 전체 푸시는 관리자만 보낼 수 있다', async () => {
        mockUserGet.mockResolvedValueOnce({
            exists: true,
            data: () => ({ role: 'employee', organizationId: 'org1', name: '직원' }),
        });
        const req = {
            auth: { uid: 'emp1', token: {} },
            data: { orgId: 'org1', title: '공지', message: '내용' },
        };
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockCreateInAppNotificationForOrg).not.toHaveBeenCalled();
        expect(mockSendPushToOrg).not.toHaveBeenCalled();
    });

    it('제목 100자·내용 500자를 넘거나 문자열이 아니면 invalid-argument — 화면 maxLength와 같은 상한', async () => {
        const base = { auth: { uid: 'user1', token: {} } };
        await expect(handler({ ...base, data: { orgId: 'org1', title: 'a'.repeat(101), message: '내용' } }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(handler({ ...base, data: { orgId: 'org1', title: '공지', message: 'b'.repeat(501) } }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(handler({ ...base, data: { orgId: 'org1', title: ['배열'], message: '내용' } }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        // 상한은 사용자 문서 조회보다 먼저 검사한다 — 길이 검사에 읽기 비용을 쓰지 않는다
        expect(mockUserGet).not.toHaveBeenCalled();
    });
});
