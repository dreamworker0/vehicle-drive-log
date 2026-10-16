/**
 * smallTriggersAndSlackInstall.test.ts — 커버리지 0%였던 작은 핸들러 셋
 * - notifyRoleChange: superAdmin **승격**일 때만 보안 알림(이미 superAdmin·다른 역할 변경·삭제는 조용히)
 * - onUserDelete: Auth 계정 삭제 시 users 문서 익명화, 문서가 없으면(NOT_FOUND) 정보 로그만
 * - getSlackInstallUrl: 기관 관리자만, **기관은 토큰에서**(요청 본문 무시), 1회성 nonce 기록,
 *   서명된 state를 실제 verifyState로 되읽어 확인
 */

const mockSendDiscordAlert = jest.fn().mockResolvedValue(undefined);
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockSet = jest.fn().mockResolvedValue(undefined);
const mockDoc = jest.fn((_id: string) => ({ update: mockUpdate, set: mockSet }));
const mockCollection = jest.fn((_name: string) => ({ doc: mockDoc }));
const mockLog = jest.fn();

jest.mock('../core/discord', () => ({ sendDiscordAlert: (...args: unknown[]) => mockSendDiscordAlert(...args) }));
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ collection: mockCollection }),
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
}));
jest.mock('../utils/helpers', () => ({ log: (...args: unknown[]) => mockLog(...args) }));
jest.mock('../core/params', () => ({
    SLACK_CLIENT_ID: { value: () => 'client-123' },
    SLACK_STATE_SECRET: { value: () => 'state-secret' },
}));
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));
// v1 auth 트리거: region().auth.user().onDelete(handler) → handler
jest.mock('firebase-functions/v1', () => ({
    region: () => ({ auth: { user: () => ({ onDelete: (handler: unknown) => handler }) } }),
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

import { notifyRoleChange } from '../handlers/triggers/notifyRoleChange';
import { onUserDelete } from '../handlers/triggers/onUserDelete';
import { getSlackInstallUrl } from '../handlers/callable/getSlackInstallUrl';
import { verifyState, STATE_TTL_SEC } from '../services/slack/oauthState';

beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockResolvedValue(undefined);
    mockSet.mockResolvedValue(undefined);
});

describe('notifyRoleChange — superAdmin 승격 경보', () => {
    type Doc = Record<string, unknown> | null;
    const run = (before: Doc, after: Doc) => (notifyRoleChange as unknown as (e: unknown) => Promise<void>)({
        data: { before: { data: () => before ?? undefined }, after: { data: () => after ?? undefined } },
    });

    it.each([
        ['직원 → superAdmin', { role: 'employee' }],
        ['관리자 → superAdmin', { role: 'admin' }],
        ['새 문서가 곧바로 superAdmin', null],
    ])('%s이면 경보를 보낸다', async (_label, before) => {
        await run(before, { role: 'superAdmin', name: '홍길동', email: 'h@x.kr', organizationId: 'org1' });
        expect(mockSendDiscordAlert).toHaveBeenCalledTimes(1);
        const alert = mockSendDiscordAlert.mock.calls[0][0];
        expect(alert.title).toContain('권한 변경 경고');
        expect(alert.fields).toEqual([
            { name: '사용자명', value: '홍길동', inline: true },
            { name: '이메일', value: 'h@x.kr', inline: true },
            { name: '추정 소속(Org ID)', value: 'org1', inline: false },
        ]);
    });

    it.each([
        ['이미 superAdmin(프로필만 수정)', { role: 'superAdmin' }, { role: 'superAdmin', name: '새 이름' }],
        ['superAdmin 강등', { role: 'superAdmin' }, { role: 'admin' }],
        ['직원 → 관리자', { role: 'employee' }, { role: 'admin' }],
        ['문서 삭제', { role: 'employee' }, null],
    ])('%s은 알리지 않는다', async (_label, before, after) => {
        await run(before, after);
        expect(mockSendDiscordAlert).not.toHaveBeenCalled();
    });

    it('빈 정보는 대체 문구로 채우고, 알림 실패는 트리거를 실패시키지 않는다', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        mockSendDiscordAlert.mockRejectedValueOnce(new Error('webhook down'));
        await expect(run({ role: 'employee' }, { role: 'superAdmin' })).resolves.toBeUndefined();
        expect(mockSendDiscordAlert.mock.calls[0][0].fields.map((f: { value: string }) => f.value))
            .toEqual(['이름 없음', '이메일 없음', '기관 없음']);
        jest.restoreAllMocks();
    });
});

describe('onUserDelete — 탈퇴 계정 익명화', () => {
    const run = (uid: string) => (onUserDelete as unknown as (u: { uid: string }) => Promise<void>)({ uid });

    it('users 문서의 이름·이메일·전화·사진을 지우고 비활성으로 표시한다', async () => {
        await run('u1');
        expect(mockCollection).toHaveBeenCalledWith('users');
        expect(mockDoc).toHaveBeenCalledWith('u1');
        expect(mockUpdate).toHaveBeenCalledWith({
            name: '*** (탈퇴된 사용자)',
            email: 'deleted-user-u1@example.com',
            phone: '***-****-****',
            status: 'disabled',
            photoURL: '',
            deletedAt: 'SERVER_TIMESTAMP',
        });
        expect(mockLog).toHaveBeenCalledWith('INFO', 'onUserDelete', expect.any(String), { uid: 'u1' });
    });

    it('문서가 없으면(NOT_FOUND) 오류가 아니라 정보로 남긴다', async () => {
        mockUpdate.mockRejectedValueOnce({ code: 5, message: 'NOT_FOUND' });
        await expect(run('u2')).resolves.toBeUndefined();
        expect(mockLog).toHaveBeenCalledWith('INFO', 'onUserDelete', expect.stringContaining('존재하지 않아'), { uid: 'u2' });
    });

    it.each([
        ['다른 오류 객체', new Error('unavailable'), 'unavailable'],
        ['원시값으로 던진 오류', 'boom', 'boom'],
        ['null', null, 'null'],
    ])('%s는 ERROR로 남기고 트리거는 끝낸다', async (_label, thrown, message) => {
        mockUpdate.mockRejectedValueOnce(thrown);
        await expect(run('u3')).resolves.toBeUndefined();
        expect(mockLog).toHaveBeenCalledWith('ERROR', 'onUserDelete', expect.any(String), { uid: 'u3', error: message });
    });
});

describe('getSlackInstallUrl — Slack 설치 URL', () => {
    type Handler = (req: Record<string, unknown>) => Promise<{ url: string }>;
    const handler = getSlackInstallUrl as unknown as Handler;
    const admin = { uid: 'a1', token: { role: 'admin', orgId: 'org1' } };

    it('로그인하지 않으면 거부한다', async () => {
        await expect(handler({ auth: null, data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it.each(['employee', undefined])('role=%s는 거부한다', async (role) => {
        await expect(handler({ auth: { uid: 'u1', token: { role, orgId: 'org1' } }, data: {} }))
            .rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockSet).not.toHaveBeenCalled();
    });

    it('토큰에 기관이 없으면 거부한다', async () => {
        await expect(handler({ auth: { uid: 'a1', token: { role: 'admin' } }, data: {} }))
            .rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('기관은 토큰에서 가져온다 — 요청 본문의 기관은 무시한다', async () => {
        const { url } = await handler({ auth: admin, data: { organizationId: 'org-evil' } });
        const state = new URL(url).searchParams.get('state')!;
        expect(verifyState(state, 'state-secret')).toMatchObject({ organizationId: 'org1', uid: 'a1' });
    });

    it('1회성 nonce를 기록하고, 서명된 state·스코프·콜백 주소로 authorize URL을 만든다', async () => {
        const before = Date.now();
        const { url } = await handler({ auth: admin, data: {} });
        const u = new URL(url);

        expect(u.origin + u.pathname).toBe('https://slack.com/oauth/v2/authorize');
        expect(u.searchParams.get('client_id')).toBe('client-123');
        expect(u.searchParams.get('scope')).toBe('chat:write,reactions:write,users:read,users:read.email,im:history');
        expect(u.searchParams.get('redirect_uri')).toBe('https://asia-northeast3-vehicle-drive-log.cloudfunctions.net/slackOauthCallback');

        const payload = verifyState(u.searchParams.get('state')!, 'state-secret')!;
        expect(payload).not.toBeNull();
        // 다른 비밀키로는 검증되지 않는다(서명)
        expect(verifyState(u.searchParams.get('state')!, 'other-secret')).toBeNull();

        expect(mockCollection).toHaveBeenCalledWith('slackOauthStates');
        expect(mockDoc).toHaveBeenCalledWith(payload.nonce);
        const record = mockSet.mock.calls[0][0];
        expect(record).toMatchObject({ organizationId: 'org1', uid: 'a1', createdAt: 'SERVER_TIMESTAMP' });
        const ttlMs = (record.expiresAt as Date).getTime() - before;
        expect(ttlMs).toBeGreaterThanOrEqual(STATE_TTL_SEC * 1000);
        expect(ttlMs).toBeLessThan(STATE_TTL_SEC * 1000 + 5000);
    });

    it('부를 때마다 다른 nonce를 쓴다(재생 차단)', async () => {
        await handler({ auth: admin, data: {} });
        await handler({ auth: admin, data: {} });
        expect(mockDoc.mock.calls[0][0]).not.toBe(mockDoc.mock.calls[1][0]);
    });

    it('superAdmin도 자기 토큰의 기관으로 연결할 수 있다', async () => {
        await expect(handler({ auth: { uid: 'sa1', token: { role: 'superAdmin', orgId: 'org2' } }, data: {} })).resolves.toBeDefined();
        expect(mockSet.mock.calls[0][0].organizationId).toBe('org2');
    });
});
