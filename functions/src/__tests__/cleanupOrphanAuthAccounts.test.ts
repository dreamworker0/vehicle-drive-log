/**
 * cleanupOrphanAuthAccounts — 소속 없이 오래 쓰이지 않은 로그인 계정 정리
 *
 * 계정 삭제는 되돌릴 수 없으므로 "누구를 지우지 않는가"를 촘촘히 고정한다.
 */
import {
    selectOrphanAccounts, toAccountLite, cleanupOrphanAuthAccounts,
    INACTIVE_DAYS, MAX_DELETE_PER_RUN, type AuthAccountLite,
} from '../services/account/cleanupOrphanAuthAccounts';

jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-11T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * DAY).toUTCString();

describe('selectOrphanAccounts — 누구를 정리하나', () => {
    const acc = (uid: string, inactiveDays: number, isSuperAdmin = false): AuthAccountLite =>
        ({ uid, lastActiveMs: NOW - inactiveDays * DAY, isSuperAdmin });

    it('users 문서가 없고 90일 넘게 활동이 없는 계정만 고른다', () => {
        const picked = selectOrphanAccounts(
            [acc('orphan-old', 120), acc('orphan-recent', 30), acc('member-old', 400)],
            new Set(['member-old']),
            NOW,
        );
        expect(picked.map((a) => a.uid)).toEqual(['orphan-old']);
    });

    it('superAdmin은 소속이 없어도 지우지 않는다', () => {
        expect(selectOrphanAccounts([acc('ops', 500, true)], new Set(), NOW)).toEqual([]);
    });

    it('경계: 정확히 90일 된 계정은 아직 대상이 아니다', () => {
        expect(selectOrphanAccounts([acc('edge', INACTIVE_DAYS)], new Set(), NOW)).toEqual([]);
    });
});

describe('toAccountLite — 마지막 활동은 로그인·토큰 갱신·생성 중 가장 최근', () => {
    it('오래전에 로그인했어도 최근 토큰 갱신이 있으면 그 시각을 쓴다', () => {
        const lite = toAccountLite({
            uid: 'u',
            metadata: { creationTime: daysAgo(300), lastSignInTime: daysAgo(200), lastRefreshTime: daysAgo(5) } as never,
            customClaims: { role: 'employee' },
        });
        expect(lite.lastActiveMs).toBe(Date.parse(daysAgo(5)));
        expect(lite.isSuperAdmin).toBe(false);
    });
});

// ── 실행 ──
function makeDeps(opts: {
    authUsers: Array<{ uid: string; inactiveDays: number; role?: string }>;
    userDocs: string[];
    deleteEnabled?: boolean;
    /** 목록을 읽은 뒤 가입해 users 문서가 생긴 uid */
    joinedLater?: string[];
}) {
    const userDocs = new Set(opts.userDocs);
    const deletedFromAuth: string[] = [];
    const deletedDocs: string[] = [];
    const deletedPrefixes: string[] = [];
    let report: Record<string, unknown> | undefined;
    const favorites = [{ id: 'f1', userId: 'orphan-1' }];
    const notifications = [{ id: 'n1', targetUid: 'orphan-1' }, { id: 'n2', targetUid: 'member' }];

    const auth = {
        listUsers: jest.fn(async () => ({
            users: opts.authUsers.map((u) => ({
                uid: u.uid,
                metadata: { creationTime: daysAgo(u.inactiveDays), lastSignInTime: daysAgo(u.inactiveDays) },
                customClaims: u.role ? { role: u.role } : undefined,
            })),
            pageToken: undefined,
        })),
        deleteUsers: jest.fn(async (uids: string[]) => {
            deletedFromAuth.push(...uids);
            return { successCount: uids.length, failureCount: 0, errors: [] };
        }),
    };

    const rows: Record<string, Array<Record<string, unknown>>> = { favorites, notifications };
    const db = {
        collection: (name: string) => ({
            select: () => ({ get: async () => ({ docs: [...userDocs].map((id) => ({ id })) }) }),
            doc: (id: string) => ({ id, path: `${name}/${id}` }),
            where: (field: string, _op: string, value: string) => ({
                get: async () => {
                    const hits = (rows[name] ?? []).filter((r) => r[field] === value);
                    return { empty: hits.length === 0, size: hits.length, docs: hits.map((r) => ({ ref: `${name}/${r.id}` })) };
                },
            }),
        }),
        getAll: async (...refs: Array<{ id: string }>) => {
            for (const uid of opts.joinedLater ?? []) userDocs.add(uid);
            return refs.map((r) => ({ exists: userDocs.has(r.id) }));
        },
        batch: () => {
            const pending: string[] = [];
            return { delete: (ref: string) => pending.push(ref), commit: async () => { deletedDocs.push(...pending); } };
        },
        doc: (path: string) => ({
            get: async () => ({ data: () => (path === 'system/authCleanup' && opts.deleteEnabled ? { deleteEnabled: true } : undefined) }),
            set: async (data: Record<string, unknown>) => { report = data; },
        }),
    };
    const bucket = { deleteFiles: jest.fn(async ({ prefix }: { prefix: string }) => { deletedPrefixes.push(prefix); }) };
    return {
        deps: { auth, db: db as never, bucket },
        auth, bucket,
        get deletedFromAuth() { return deletedFromAuth; },
        get deletedDocs() { return deletedDocs; },
        get deletedPrefixes() { return deletedPrefixes; },
        get report() { return report; },
    };
}

describe('cleanupOrphanAuthAccounts — 실행', () => {
    beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
    afterEach(() => jest.restoreAllMocks());

    const users = [
        { uid: 'orphan-1', inactiveDays: 200 },
        { uid: 'orphan-recent', inactiveDays: 10 },
        { uid: 'member', inactiveDays: 400 },
        { uid: 'ops', inactiveDays: 400, role: 'superAdmin' },
    ];

    it('스위치가 꺼져 있으면(기본) 아무것도 지우지 않고 대상 수만 보고한다', async () => {
        const t = makeDeps({ authUsers: users, userDocs: ['member'] });
        const result = await cleanupOrphanAuthAccounts(t.deps, NOW);

        expect(result).toMatchObject({ mode: 'report', totalAccounts: 4, candidates: 1, deleted: 0 });
        expect(t.auth.deleteUsers).not.toHaveBeenCalled();
        expect(t.bucket.deleteFiles).not.toHaveBeenCalled();
        expect(t.report).toMatchObject({ lastResult: { mode: 'report', candidates: 1, inactiveDays: INACTIVE_DAYS } });
    });

    it('스위치를 켜면 대상 계정과 그 uid에 남은 즐겨찾기·알림·첨부를 지운다 — 다른 사람 것은 그대로', async () => {
        const t = makeDeps({ authUsers: users, userDocs: ['member'], deleteEnabled: true });
        const result = await cleanupOrphanAuthAccounts(t.deps, NOW);

        expect(result).toMatchObject({ mode: 'delete', candidates: 1, deleted: 1, failed: 0 });
        expect(t.deletedFromAuth).toEqual(['orphan-1']);
        expect(t.deletedDocs.sort()).toEqual(['favorites/f1', 'notifications/n1']);
        expect(t.deletedPrefixes).toEqual(['feedbacks/orphan-1/', 'feedbacks/ocr-report/orphan-1/']);
    });

    it('목록을 읽은 뒤 가입한 사람은 지우기 직전 다시 확인해 건너뛴다', async () => {
        const t = makeDeps({ authUsers: users, userDocs: ['member'], deleteEnabled: true, joinedLater: ['orphan-1'] });
        const result = await cleanupOrphanAuthAccounts(t.deps, NOW);

        expect(result).toMatchObject({ deleted: 0, skippedJoined: 1 });
        expect(t.auth.deleteUsers).not.toHaveBeenCalled();
    });

    it(`한 번에 ${MAX_DELETE_PER_RUN}개까지만 지운다 — 판정이 틀렸을 때 피해를 묶어 둔다`, async () => {
        const many = Array.from({ length: MAX_DELETE_PER_RUN + 50 }, (_, i) => ({ uid: `o${i}`, inactiveDays: 200 }));
        const t = makeDeps({ authUsers: many, userDocs: [], deleteEnabled: true });
        const result = await cleanupOrphanAuthAccounts(t.deps, NOW);

        expect(result.candidates).toBe(MAX_DELETE_PER_RUN + 50);
        expect(result.deleted).toBe(MAX_DELETE_PER_RUN);
    });
});
