/**
 * notifySlackUser.test.ts — outbound Slack DM 발송 헬퍼
 * Firestore(users)·resolveSlackUser·slackApi는 모두 mock.
 */
const mockUserGet = jest.fn();
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: () => ({ doc: () => ({ get: mockUserGet }) }),
    }),
}));

const mockFindByOrg = jest.fn();
const mockGetIntegration = jest.fn();
jest.mock('../services/slack/resolveSlackUser', () => ({
    findSlackIntegrationByOrg: (...a: unknown[]) => mockFindByOrg(...a),
    getSlackIntegration: (...a: unknown[]) => mockGetIntegration(...a),
}));

const mockLookup = jest.fn();
const mockPost = jest.fn();
jest.mock('../services/slack/slackApi', () => ({
    lookupUserByEmail: (...a: unknown[]) => mockLookup(...a),
    postMessage: (...a: unknown[]) => mockPost(...a),
}));

jest.mock('../utils/helpers', () => ({ log: jest.fn() }));

import { resolveOrgSlackBotToken, sendSlackDMToUser } from '../services/slack/notifySlackUser';

function userDoc(email: string | null) {
    return email === null
        ? { exists: false }
        : { exists: true, data: () => ({ email }) };
}

describe('resolveOrgSlackBotToken', () => {
    beforeEach(() => jest.clearAllMocks());

    it('미연동 기관이면 null', async () => {
        mockFindByOrg.mockResolvedValue(null);
        expect(await resolveOrgSlackBotToken('org1')).toBeNull();
        expect(mockGetIntegration).not.toHaveBeenCalled();
    });

    it('연동 문서는 있으나 비활성/복호화 실패면 null', async () => {
        mockFindByOrg.mockResolvedValue({ teamId: 'T1' });
        mockGetIntegration.mockResolvedValue(null);
        expect(await resolveOrgSlackBotToken('org1')).toBeNull();
    });

    it('정상 연동이면 복호화된 봇 토큰을 반환한다', async () => {
        mockFindByOrg.mockResolvedValue({ teamId: 'T1' });
        mockGetIntegration.mockResolvedValue({ organizationId: 'org1', botToken: 'xoxb-1' });
        expect(await resolveOrgSlackBotToken('org1')).toBe('xoxb-1');
        expect(mockGetIntegration).toHaveBeenCalledWith('T1');
    });

    it('조회 중 예외가 나도 삼키고 null', async () => {
        mockFindByOrg.mockRejectedValue(new Error('firestore down'));
        expect(await resolveOrgSlackBotToken('org1')).toBeNull();
    });
});

describe('sendSlackDMToUser', () => {
    beforeEach(() => jest.clearAllMocks());

    it('사용자 이메일이 없으면 false (발송 안 함)', async () => {
        mockUserGet.mockResolvedValue(userDoc(null));
        expect(await sendSlackDMToUser('xoxb', 'uid1', '안녕')).toBe(false);
        expect(mockLookup).not.toHaveBeenCalled();
        expect(mockPost).not.toHaveBeenCalled();
    });

    it('이메일이 Slack 미매칭이면 false (발송 안 함)', async () => {
        mockUserGet.mockResolvedValue(userDoc('a@b.com'));
        mockLookup.mockResolvedValue(null);
        expect(await sendSlackDMToUser('xoxb', 'uid1', '안녕')).toBe(false);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it('정상 경로: 이메일→SlackUserId 조회 후 DM 발송', async () => {
        mockUserGet.mockResolvedValue(userDoc('a@b.com'));
        mockLookup.mockResolvedValue('U123');
        mockPost.mockResolvedValue(true);

        expect(await sendSlackDMToUser('xoxb', 'uid1', '🚗 예약 임박')).toBe(true);
        expect(mockLookup).toHaveBeenCalledWith('xoxb', 'a@b.com');
        expect(mockPost).toHaveBeenCalledWith('xoxb', 'U123', '🚗 예약 임박');
    });

    it('postMessage 실패면 false', async () => {
        mockUserGet.mockResolvedValue(userDoc('a@b.com'));
        mockLookup.mockResolvedValue('U123');
        mockPost.mockResolvedValue(false);
        expect(await sendSlackDMToUser('xoxb', 'uid1', 'x')).toBe(false);
    });

    it('예외가 나도 삼키고 false (알림 파이프라인을 막지 않는다)', async () => {
        mockUserGet.mockRejectedValue(new Error('boom'));
        expect(await sendSlackDMToUser('xoxb', 'uid1', 'x')).toBe(false);
    });
});
