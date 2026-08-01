/**
 * sendBroadcastNotice.test — 전체 기관 일괄 공지
 *
 * 되돌릴 수 없는 대량 행위라 다음을 고정한다.
 *  (1) superAdmin 외에는 아무도 못 보낸다
 *  (2) dryRun은 **아무것도 쓰지 않고** 대상 수만 준다
 *  (3) 재클릭·재시도가 알림을 중복 생성하지 않는다 (문서 ID 고정)
 *  (4) 비활성·기관 미소속 계정은 대상에서 빠진다
 *  (5) 500건 배치 상한을 넘기지 않는다
 *  (6) 푸시 실패가 앱 내 알림을 되돌리지 않는다
 */

let capturedHandler: any;
let capturedOptions: any;

class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

jest.mock('firebase-functions/v2/https', () => ({
    onCall: (options: any, handler: any) => {
        capturedOptions = options;
        capturedHandler = handler;
    },
    HttpsError: MockHttpsError,
}));

/** users 컬렉션이 돌려줄 문서들 */
let userDocs: { id: string; data: Record<string, unknown> }[] = [];

const batchSets: { id: string; data: any }[] = [];
const commitCalls: number[] = [];
/** 앱 내 알림 커밋과 푸시 발송의 실제 순서 */
const callOrder: string[] = [];
let currentBatchSize = 0;

const makeBatch = () => {
    currentBatchSize = 0;
    return {
        set: (ref: any, data: any) => {
            batchSets.push({ id: ref.__id, data });
            currentBatchSize += 1;
        },
        commit: async () => { commitCalls.push(currentBatchSize); callOrder.push('commit'); },
    };
};

/** broadcasts 문서에 대한 set 호출 기록 (발송 이력) */
const broadcastSets: { id: string; data: any; merge: boolean }[] = [];
let broadcastSetFails = false;

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: (name: string) => ({
            doc: (id: string) => ({
                __col: name,
                __id: id,
                set: async (data: any, opts?: any) => {
                    if (name !== 'broadcasts') throw new Error(`예상하지 못한 직접 쓰기: ${name}`);
                    if (broadcastSetFails) throw new Error('이력 쓰기 실패');
                    broadcastSets.push({ id, data, merge: !!opts?.merge });
                    callOrder.push(`broadcast:${data.status}`);
                },
            }),
            get: async () => {
                if (name !== 'users') throw new Error(`예상하지 못한 컬렉션 조회: ${name}`);
                return {
                    forEach: (cb: (d: any) => void) =>
                        userDocs.forEach((u) => cb({ id: u.id, data: () => u.data })),
                };
            },
        }),
        batch: makeBatch,
    }),
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TS') },
}));

const mockSendEach = jest.fn();
jest.mock('firebase-admin/messaging', () => ({
    getMessaging: () => ({
        sendEach: (...args: unknown[]) => {
            callOrder.push('push');
            return mockSendEach(...args);
        },
    }),
}));

const mockLog = jest.fn();
const mockCheckRateLimit = jest.fn().mockResolvedValue(undefined);
jest.mock('../utils/helpers', () => ({
    log: (...args: unknown[]) => mockLog(...args),
    wrapHandler: (_name: string, handler: any) => handler,
    requireSuperAdmin: (request: any) => {
        if (!request.auth) throw new MockHttpsError('unauthenticated', '로그인이 필요합니다.');
        if (request.auth.token?.role !== 'superAdmin') {
            throw new MockHttpsError('permission-denied', '시스템 관리자만 사용할 수 있습니다.');
        }
    },
}));
jest.mock('../utils/rateLimit', () => ({
    checkRateLimitByUid: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

require('../handlers/callable/sendBroadcastNotice');

const NOTICE_ID = 'notice0801abcdef';
const SA = { uid: 'sa-1', token: { role: 'superAdmin' } };

const call = (data: any = {}, auth: any = SA) =>
    capturedHandler({
        auth,
        data: { title: '약관 개정 안내', message: '8월 10일부터 시행됩니다.', noticeId: NOTICE_ID, ...data },
    });

const activeUser = (id: string, token?: string) => ({
    id,
    data: { organizationId: 'org-1', status: 'active', ...(token ? { fcmToken: token } : {}) },
});

beforeEach(() => {
    jest.clearAllMocks();
    batchSets.length = 0;
    commitCalls.length = 0;
    callOrder.length = 0;
    broadcastSets.length = 0;
    broadcastSetFails = false;
    userDocs = [activeUser('u1', 'tok1'), activeUser('u2', 'tok2')];
    mockSendEach.mockResolvedValue({ successCount: 2, failureCount: 0 });
});

describe('sendBroadcastNotice — 권한·입력 검증', () => {
    it('App Check를 강제하고 팬아웃에 맞는 타임아웃·메모리를 잡는다', () => {
        expect(capturedOptions).toMatchObject({
            region: 'asia-northeast3', enforceAppCheck: true, timeoutSeconds: 300, memory: '512MiB',
        });
    });

    it('비로그인 호출은 거부한다', async () => {
        await expect(call({}, null)).rejects.toMatchObject({ code: 'unauthenticated' });
        expect(batchSets).toHaveLength(0);
    });

    it('기관 관리자도 거부한다 — 전역 공지는 운영자만 보낸다', async () => {
        await expect(call({}, { uid: 'admin-1', token: { role: 'admin' } }))
            .rejects.toMatchObject({ code: 'permission-denied' });
        expect(batchSets).toHaveLength(0);
    });

    it('제목·본문이 비었거나 상한을 넘으면 거부한다', async () => {
        await expect(call({ title: '' })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call({ title: '   ' })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call({ title: 'x'.repeat(101) })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call({ message: '' })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call({ message: 'x'.repeat(1001) })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(batchSets).toHaveLength(0);
    });

    it('공지 식별자 형식이 어긋나면 거부한다 — 문서 ID에 들어가는 값이다', async () => {
        for (const bad of ['short', '../escape', 'has space', undefined]) {
            await expect(call({ noticeId: bad })).rejects.toMatchObject({ code: 'invalid-argument' });
        }
    });

    it('연타 방지 한도를 적용한다', async () => {
        await call();
        expect(mockCheckRateLimit).toHaveBeenCalledWith('sendBroadcastNotice', 'sa-1', 30, 3600);
    });
});

describe('sendBroadcastNotice — dryRun', () => {
    it('아무것도 쓰지 않고 대상 수만 돌려준다', async () => {
        const res = await call({ dryRun: true });

        expect(res).toEqual({ success: true, dryRun: true, recipientCount: 2, pushableCount: 2 });
        expect(batchSets).toHaveLength(0);
        expect(mockSendEach).not.toHaveBeenCalled();
    });

    it('푸시 가능 인원을 따로 센다 — 토큰 없는 사용자는 앱 내 알림만 받는다', async () => {
        userDocs = [activeUser('u1', 'tok1'), activeUser('u2')];
        const res = await call({ dryRun: true });
        expect(res).toMatchObject({ recipientCount: 2, pushableCount: 1 });
    });
});

describe('sendBroadcastNotice — 수신 대상', () => {
    it('비활성 계정은 제외한다 — 로그인할 수 없으므로 알림을 남길 이유가 없다', async () => {
        userDocs = [
            activeUser('u1', 'tok1'),
            { id: 'u2', data: { organizationId: 'org-1', status: 'disabled', fcmToken: 'tok2' } },
        ];
        const res = await call({ dryRun: true });
        expect(res).toMatchObject({ recipientCount: 1 });
    });

    it('기관 미소속(superAdmin·가입 대기)은 제외한다', async () => {
        userDocs = [
            activeUser('u1', 'tok1'),
            { id: 'sa-1', data: { status: 'active' } },
            { id: 'u3', data: { organizationId: null, status: 'active' } },
        ];
        const res = await call({ dryRun: true });
        expect(res).toMatchObject({ recipientCount: 1 });
    });

    it('status 필드가 없는 구 문서는 활성으로 본다', async () => {
        userDocs = [{ id: 'legacy', data: { organizationId: 'org-1' } }];
        const res = await call({ dryRun: true });
        expect(res).toMatchObject({ recipientCount: 1 });
    });

    it('대상이 0명이면 발송하지 않고 실패로 알린다', async () => {
        userDocs = [];
        await expect(call()).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(batchSets).toHaveLength(0);
    });
});

describe('sendBroadcastNotice — 앱 내 알림', () => {
    it('수신자마다 알림 문서를 만들고 키 집합을 고정한다', async () => {
        await call();

        expect(batchSets).toHaveLength(2);
        expect(Object.keys(batchSets[0].data).sort())
            .toEqual(['createdAt', 'message', 'read', 'targetUid', 'title', 'type']);
        expect(batchSets[0].data).toMatchObject({
            targetUid: 'u1', type: 'service_notice', title: '약관 개정 안내', read: false,
        });
    });

    it('문서 ID가 공지+수신자로 고정돼 재발송이 중복을 만들지 않는다', async () => {
        await call();
        await call();

        expect(batchSets.map((b) => b.id)).toEqual([
            `broadcast_${NOTICE_ID}_u1`, `broadcast_${NOTICE_ID}_u2`,
            `broadcast_${NOTICE_ID}_u1`, `broadcast_${NOTICE_ID}_u2`,
        ]);
    });

    it('500건 배치 상한을 넘기지 않는다', async () => {
        userDocs = Array.from({ length: 1201 }, (_, i) => activeUser(`u${i}`));
        mockSendEach.mockResolvedValue({ successCount: 0, failureCount: 0 });

        await call();

        // 1201명 → 500 + 500 + 201
        expect(commitCalls).toEqual([500, 500, 201]);
        expect(Math.max(...commitCalls)).toBeLessThanOrEqual(500);
    });

    it('제목·본문의 앞뒤 공백을 제거해 저장한다', async () => {
        await call({ title: '  공지  ', message: '  본문  ' });
        expect(batchSets[0].data).toMatchObject({ title: '공지', message: '본문' });
    });
});

describe('sendBroadcastNotice — 푸시', () => {
    it('토큰 보유자에게만 보내고 결과 수를 돌려준다', async () => {
        userDocs = [activeUser('u1', 'tok1'), activeUser('u2'), activeUser('u3', 'tok3')];
        mockSendEach.mockResolvedValue({ successCount: 2, failureCount: 0 });

        const res = await call();

        expect(mockSendEach).toHaveBeenCalledTimes(1);
        expect(mockSendEach.mock.calls[0][0].map((m: any) => m.token)).toEqual(['tok1', 'tok3']);
        expect(res).toMatchObject({ recipientCount: 3, pushSent: 2, pushFailed: 0 });
    });

    it('토큰이 하나도 없으면 푸시 API를 부르지 않는다', async () => {
        userDocs = [activeUser('u1'), activeUser('u2')];
        const res = await call();

        expect(mockSendEach).not.toHaveBeenCalled();
        expect(res).toMatchObject({ pushSent: 0, pushFailed: 0 });
        // 앱 내 알림은 그대로 남는다
        expect(batchSets).toHaveLength(2);
    });

    it('푸시 청크가 통째로 실패해도 앱 내 알림을 되돌리지 않는다', async () => {
        mockSendEach.mockRejectedValue(new Error('FCM 장애'));

        const res = await call();

        expect(res).toMatchObject({ success: true, pushSent: 0, pushFailed: 2 });
        expect(batchSets).toHaveLength(2);
        expect(mockLog).toHaveBeenCalledWith('ERROR', 'sendBroadcastNotice', expect.any(String), expect.any(Object));
    });

    it('푸시도 500건 단위로 나눠 보낸다', async () => {
        userDocs = Array.from({ length: 1100 }, (_, i) => activeUser(`u${i}`, `tok${i}`));
        mockSendEach.mockResolvedValue({ successCount: 500, failureCount: 0 });

        await call();

        expect(mockSendEach).toHaveBeenCalledTimes(3);
        expect(mockSendEach.mock.calls.map((c) => c[0].length)).toEqual([500, 500, 100]);
    });

    it('앱 내 알림을 먼저 쓴 뒤 푸시한다 — 푸시를 놓쳐도 알림함에는 남아야 한다', async () => {
        userDocs = Array.from({ length: 600 }, (_, i) => activeUser(`u${i}`, `tok${i}`));
        mockSendEach.mockResolvedValue({ successCount: 500, failureCount: 0 });

        await call();

        // 커밋 2회(500+100)가 모두 끝난 뒤에 푸시 2회가 나가야 한다.
        // 순서가 뒤집히면 푸시를 받은 사용자가 알림함을 열었을 때 아무것도 없을 수 있다.
        // (이력 쓰기는 이 테스트의 관심사가 아니므로 걸러낸다 — 순서는 별도 테스트가 본다.)
        expect(callOrder.filter((c) => !c.startsWith('broadcast:')))
            .toEqual(['commit', 'commit', 'push', 'push']);
    });
});

describe('sendBroadcastNotice — 발송 이력', () => {
    it('dryRun은 이력을 남기지 않는다', async () => {
        await call({ dryRun: true });
        expect(broadcastSets).toHaveLength(0);
    });

    it('공지 식별자를 문서 ID로 써서 발송 1건당 이력 1건이 된다', async () => {
        await call();
        expect(broadcastSets.map((b) => b.id)).toEqual([NOTICE_ID, NOTICE_ID]);
    });

    it('앱 내 알림 커밋 직후 sending으로 먼저 남긴다', async () => {
        await call();

        // 푸시까지 끝난 뒤에 한 번만 쓰면, 그 사이 죽었을 때 알림은 나갔는데 이력이 없다.
        expect(callOrder).toEqual(['commit', 'broadcast:sending', 'push', 'broadcast:sent']);
        expect(broadcastSets[0].data).toMatchObject({
            title: '약관 개정 안내',
            actorUid: 'sa-1',
            recipientCount: 2,
            status: 'sending',
        });
        expect(broadcastSets[0].merge).toBe(false);
    });

    it('푸시 결과를 merge로 덧써 sent로 마감한다', async () => {
        mockSendEach.mockResolvedValue({ successCount: 1, failureCount: 1 });
        await call();

        expect(broadcastSets[1]).toMatchObject({
            merge: true,
            data: { pushSent: 1, pushFailed: 1, status: 'sent' },
        });
    });

    it('푸시가 전부 실패해도 이력은 sent로 마감하고 실패 수를 남긴다', async () => {
        mockSendEach.mockRejectedValue(new Error('FCM 장애'));
        await call();

        expect(broadcastSets[1].data).toMatchObject({ pushSent: 0, pushFailed: 2, status: 'sent' });
    });

    it('이력 갱신이 실패해도 발송 자체는 성공으로 반환한다', async () => {
        // 이력은 부수 기록이다 — 여기서 throw하면 이미 나간 알림을 되돌릴 수 없는데
        // 호출자에게는 실패로 보여 재발송을 유도하게 된다.
        let calls = 0;
        const origPush = broadcastSets.push.bind(broadcastSets);
        broadcastSets.push = ((...args: any[]) => {
            calls += 1;
            if (calls === 2) throw new Error('이력 갱신 실패');
            return origPush(...args);
        }) as never;

        const res = await call();

        expect(res).toMatchObject({ success: true, recipientCount: 2 });
        expect(mockLog).toHaveBeenCalledWith('ERROR', 'sendBroadcastNotice', '발송 이력 갱신 실패', expect.any(Object));
        broadcastSets.push = origPush;
    });

    it('시작 이력 쓰기가 실패하면 발송을 실패로 알린다 — 이력 없는 발송을 만들지 않는다', async () => {
        broadcastSetFails = true;
        await expect(call()).rejects.toThrow();
        // 앱 내 알림은 이미 커밋됐지만 푸시는 나가지 않는다
        expect(mockSendEach).not.toHaveBeenCalled();
    });
});
