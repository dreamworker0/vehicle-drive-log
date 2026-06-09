/**
 * sendBulkReminder.test.ts
 * - 미활성 기관 일괄 알림톡 발송 onCall 함수 단위 테스트
 * - Firestore, 알림톡 발송은 mock 처리
 */

// ── sendAlimtalk Mock ──
const mockSendReminderAlimtalk = jest.fn();
jest.mock('../services/alimtalk/sendAlimtalk', () => ({
    sendReminderAlimtalk: mockSendReminderAlimtalk,
}));

// ── Firestore Mock ──
// collection 이름에 따라 다른 mock 반환
const mockOrgsGet = jest.fn();
const mockMembersGet = jest.fn();

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: jest.fn((name: string) => {
            if (name === 'organizations') {
                return { where: jest.fn().mockReturnThis(), get: mockOrgsGet };
            }
            // users collection (members query)
            return {
                where: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                get: mockMembersGet,
            };
        }),
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

import { sendBulkReminder } from "../handlers/callable/sendBulkReminder";

const handler = sendBulkReminder as unknown as (req: Record<string, unknown>) => Promise<unknown>;

describe('sendBulkReminder — 미활성 기관 일괄 알림톡 발송', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('인증이 없으면 unauthenticated 에러를 던진다', async () => {
        const req = { auth: null, data: {} };
        await expect(handler(req)).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('superAdmin이 아니면 permission-denied 에러를 던진다', async () => {
        const req = { auth: { uid: 'user1', token: { role: 'admin' } }, data: {} };
        await expect(handler(req)).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('승인된 기관이 없으면 빈 결과를 반환한다', async () => {
        mockOrgsGet.mockResolvedValueOnce({ docs: [] });

        const req = { auth: { uid: 'admin1', token: { role: 'superAdmin' } }, data: {} };
        const result = await handler(req) as Record<string, unknown>;

        expect(result.sentCount).toBe(0);
        expect(result.failCount).toBe(0);
        expect(result.noPhoneCount).toBe(0);
        expect(result.results).toEqual([]);
    });

    it('직원이 있는 기관은 건너뛰고 알림톡을 발송하지 않는다', async () => {
        const orgDoc = {
            id: 'org1',
            data: () => ({ name: '활성기관', applicantPhone: '01012345678', inviteCode: 'ABC123' }),
        };
        mockOrgsGet.mockResolvedValueOnce({ docs: [orgDoc] });
        mockMembersGet.mockResolvedValueOnce({ empty: false }); // 직원 있음

        const req = { auth: { uid: 'admin1', token: { role: 'superAdmin' } }, data: {} };
        const result = await handler(req) as Record<string, unknown>;

        expect(result.sentCount).toBe(0);
        expect(result.failCount).toBe(0);
        expect(mockSendReminderAlimtalk).not.toHaveBeenCalled();
    });

    it('전화번호가 없는 기관은 noPhoneCount를 증가시킨다', async () => {
        const orgDocNoPhone = {
            id: 'org2',
            data: () => ({ name: '번호없는기관' }), // phone 없음
        };
        mockOrgsGet.mockResolvedValueOnce({ docs: [orgDocNoPhone] });
        mockMembersGet.mockResolvedValueOnce({ empty: true }); // 직원 없음

        const req = { auth: { uid: 'admin1', token: { role: 'superAdmin' } }, data: {} };
        const result = await handler(req) as Record<string, unknown>;

        expect(result.noPhoneCount).toBe(1);
        expect(mockSendReminderAlimtalk).not.toHaveBeenCalled();
    });

    it('초대코드가 없는 기관은 failCount를 증가시킨다', async () => {
        const orgDocNoCode = {
            id: 'org3',
            data: () => ({ name: '코드없는기관', applicantPhone: '01099999999' }), // inviteCode 없음
        };
        mockOrgsGet.mockResolvedValueOnce({ docs: [orgDocNoCode] });
        mockMembersGet.mockResolvedValueOnce({ empty: true });

        const req = { auth: { uid: 'admin1', token: { role: 'superAdmin' } }, data: {} };
        const result = await handler(req) as Record<string, unknown>;

        expect(result.failCount).toBe(1);
        expect(mockSendReminderAlimtalk).not.toHaveBeenCalled();
    });

    it('정상 처리: 미활성 기관에 알림톡을 발송하고 sentCount를 반환한다', async () => {
        const orgDoc = {
            id: 'org4',
            data: () => ({
                name: '미활성기관',
                applicantPhone: '01011112222',
                applicantName: '홍길동',
                inviteCode: 'CODE01',
            }),
        };
        mockOrgsGet.mockResolvedValueOnce({ docs: [orgDoc] });
        mockMembersGet.mockResolvedValueOnce({ empty: true }); // 직원 없음
        mockSendReminderAlimtalk.mockResolvedValueOnce({ success: true });

        const req = { auth: { uid: 'admin1', token: { role: 'superAdmin' } }, data: {} };
        const result = await handler(req) as Record<string, unknown>;

        expect(result.sentCount).toBe(1);
        expect(result.failCount).toBe(0);
        expect(mockSendReminderAlimtalk).toHaveBeenCalledWith(
            '01011112222',
            '홍길동',
            '미활성기관',
            'CODE01'
        );
    });

    it('알림톡 발송 실패 시 failCount를 증가시킨다', async () => {
        const orgDoc = {
            id: 'org5',
            data: () => ({
                name: '실패기관',
                applicantPhone: '01033334444',
                applicantName: '김철수',
                inviteCode: 'FAIL01',
            }),
        };
        mockOrgsGet.mockResolvedValueOnce({ docs: [orgDoc] });
        mockMembersGet.mockResolvedValueOnce({ empty: true });
        mockSendReminderAlimtalk.mockResolvedValueOnce({ success: false, message: '발송 실패' });

        const req = { auth: { uid: 'admin1', token: { role: 'superAdmin' } }, data: {} };
        const result = await handler(req) as Record<string, unknown>;

        expect(result.sentCount).toBe(0);
        expect(result.failCount).toBe(1);
    });
});
