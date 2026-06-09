/**
 * notifyNewApplication.test.ts
 * - 신규 신청 / 승인 / 거절 상태 변화 감지 분기 로직 테스트
 * - nodemailer, Discord 알림은 mock 처리
 */

// ── 외부 의존성 Mock ──
jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({
        sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-id' }),
    })),
}));

jest.mock('../core/discord', () => ({
    sendDiscordAlert: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: (_doc: string, handler: any) => handler,
}));

import { sendDiscordAlert } from "../core/discord";

// notifyNewApplication 로직 핵심 함수만 재현하여 테스트
// (함수 내부 상태 변화 감지 로직 추출)
function detectChange(before: Record<string, any> | null, after: Record<string, any> | null) {
    if (!after) return { isNewApplication: false, isRejected: false, isApproved: false };

    const isNewApplication =
        (!before && after.status === 'pending') ||
        (before?.status !== 'pending' && after.status === 'pending');
    const isRejected = before?.status !== 'rejected' && after.status === 'rejected';
    const isApproved = before?.status !== 'approved' && after.status === 'approved';

    return { isNewApplication, isRejected, isApproved };
}

describe('notifyNewApplication — 상태 변화 감지 로직', () => {
    describe('isNewApplication', () => {
        it('신규 문서 생성 (before=null, status=pending) → true', () => {
            const { isNewApplication } = detectChange(null, { status: 'pending' });
            expect(isNewApplication).toBe(true);
        });

        it('status가 rejected → pending으로 변경 → true', () => {
            const { isNewApplication } = detectChange(
                { status: 'rejected' },
                { status: 'pending' }
            );
            expect(isNewApplication).toBe(true);
        });

        it('이미 pending인 상태에서 다른 필드만 변경 → false', () => {
            const { isNewApplication } = detectChange(
                { status: 'pending', name: '기존기관' },
                { status: 'pending', name: '변경기관' }
            );
            expect(isNewApplication).toBe(false);
        });

        it('after가 null (문서 삭제) → false', () => {
            const { isNewApplication } = detectChange({ status: 'pending' }, null);
            expect(isNewApplication).toBe(false);
        });
    });

    describe('isRejected', () => {
        it('pending → rejected → true', () => {
            const { isRejected } = detectChange({ status: 'pending' }, { status: 'rejected' });
            expect(isRejected).toBe(true);
        });

        it('이미 rejected인 상태에서 재업데이트 → false', () => {
            const { isRejected } = detectChange({ status: 'rejected' }, { status: 'rejected' });
            expect(isRejected).toBe(false);
        });

        it('approved → rejected → true', () => {
            const { isRejected } = detectChange({ status: 'approved' }, { status: 'rejected' });
            expect(isRejected).toBe(true);
        });
    });

    describe('isApproved', () => {
        it('pending → approved → true', () => {
            const { isApproved } = detectChange({ status: 'pending' }, { status: 'approved' });
            expect(isApproved).toBe(true);
        });

        it('이미 approved인 상태에서 재업데이트 → false', () => {
            const { isApproved } = detectChange({ status: 'approved' }, { status: 'approved' });
            expect(isApproved).toBe(false);
        });

        it('신규 문서 (before=null) + approved → true', () => {
            const { isApproved } = detectChange(null, { status: 'approved' });
            expect(isApproved).toBe(true);
        });
    });

    describe('복합 상태', () => {
        it('상태 변화가 없을 때 세 플래그 모두 false', () => {
            const result = detectChange(
                { status: 'pending' },
                { status: 'pending' }
            );
            expect(result.isNewApplication).toBe(false);
            expect(result.isRejected).toBe(false);
            expect(result.isApproved).toBe(false);
        });
    });

    describe('sendDiscordAlert mock 동작 확인', () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        it('sendDiscordAlert가 mock으로 동작한다', async () => {
            await sendDiscordAlert({
                title: '테스트',
                description: '테스트 메시지',
                color: 0,
                fields: [],
            });
            expect(sendDiscordAlert).toHaveBeenCalledTimes(1);
        });
    });
});
