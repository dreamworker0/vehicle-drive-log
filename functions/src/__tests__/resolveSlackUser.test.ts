/**
 * resolveSlackUser.test.ts — getSlackIntegration 복호화 경로
 * Firestore·tokenCrypto·slackApi·auth는 모두 mock.
 */
const mockDocGet = jest.fn();
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: () => ({ doc: () => ({ get: mockDocGet }) }),
    }),
    FieldValue: { serverTimestamp: () => 'ts' },
}));
jest.mock('firebase-admin/auth', () => ({ getAuth: () => ({ getUserByEmail: jest.fn() }) }));
jest.mock('../services/slack/slackApi', () => ({ getSlackUserInfo: jest.fn() }));
const mockDecrypt = jest.fn();
jest.mock('../services/slack/tokenCrypto', () => ({
    decryptSlackToken: (...args: unknown[]) => mockDecrypt(...args),
}));
jest.mock('../utils/helpers', () => ({ log: jest.fn() }));

import { getSlackIntegration } from '../services/slack/resolveSlackUser';

const CIPHER = { v: 1, cipher: 'c', iv: 'i', authTag: 't' };

function docWith(data: Record<string, unknown> | null) {
    return data === null
        ? { exists: false }
        : { exists: true, data: () => data };
}

describe('getSlackIntegration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDecrypt.mockReturnValue('xoxb-decrypted');
    });

    it('활성 문서면 기관 + 복호화된 봇 토큰을 반환한다', async () => {
        mockDocGet.mockResolvedValue(docWith({
            enabled: true, organizationId: 'org1', teamName: '우리기관', tokenCipher: CIPHER,
        }));

        const result = await getSlackIntegration('T123');

        expect(mockDecrypt).toHaveBeenCalledWith('T123', CIPHER);
        expect(result).toEqual({ organizationId: 'org1', botToken: 'xoxb-decrypted', teamName: '우리기관' });
    });

    it('문서가 없으면 null', async () => {
        mockDocGet.mockResolvedValue(docWith(null));
        expect(await getSlackIntegration('T123')).toBeNull();
    });

    it('enabled=false면 null', async () => {
        mockDocGet.mockResolvedValue(docWith({ enabled: false, organizationId: 'org1', tokenCipher: CIPHER }));
        expect(await getSlackIntegration('T123')).toBeNull();
    });

    it('organizationId가 없으면 null', async () => {
        mockDocGet.mockResolvedValue(docWith({ enabled: true, tokenCipher: CIPHER }));
        expect(await getSlackIntegration('T123')).toBeNull();
    });

    it('암호화된 토큰이 없으면 null (복호화 시도 안 함)', async () => {
        mockDocGet.mockResolvedValue(docWith({ enabled: true, organizationId: 'org1' }));
        expect(await getSlackIntegration('T123')).toBeNull();
        expect(mockDecrypt).not.toHaveBeenCalled();
    });

    it('복호화가 실패하면 null (예외를 삼킨다)', async () => {
        mockDocGet.mockResolvedValue(docWith({ enabled: true, organizationId: 'org1', tokenCipher: CIPHER }));
        mockDecrypt.mockImplementation(() => { throw new Error('키 불일치'); });
        expect(await getSlackIntegration('T123')).toBeNull();
    });
});
