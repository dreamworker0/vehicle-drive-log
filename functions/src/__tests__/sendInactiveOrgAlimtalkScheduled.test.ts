/**
 * sendInactiveOrgAlimtalkScheduled.test.ts — 미활성 기관 리마인드 알림톡 스케줄러
 *
 * 평일 14시에 돌며 "지난주(월~일)에 승인됐는데 아직 직원이 한 명도 없는 기관"에 리마인드를 보낸다.
 * 고정하는 계약:
 *  - 공휴일이면 발송하지 않는다 / 이번 주에 이미 보냈으면 다시 보내지 않는다(주 1회)
 *  - 이번 주 월요일 키는 KST 기준이다(UTC 날짜가 하루 늦은 자정 직후에도 같은 주)
 *  - 지난주 범위는 KST 00:00 ~ 23:59:59.999 이다
 *  - 대상은 승인 기관 중 직원이 없는 곳, 번호·초대코드 없으면 보내지 않고 사유를 남긴다
 *  - 디스코드 브리핑 실패가 알림톡 발송을 막지 않는다
 * 로그 출력은 단언하지 않는다(로거 교체와 무관하게 유지).
 */

jest.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (_opts: unknown, handler: unknown) => handler,
}));
jest.mock('../core/params', () => ({ ALIMTALK_PROXY_TOKEN: {} }));

const mockSendReminder = jest.fn();
jest.mock('../services/alimtalk/sendAlimtalk', () => ({
    sendReminderAlimtalk: (...a: unknown[]) => mockSendReminder(...a),
}));

const mockSendDiscordAlert = jest.fn();
jest.mock('../core/discord', () => ({
    sendDiscordAlert: (...a: unknown[]) => mockSendDiscordAlert(...a),
}));

const mockRecordHeartbeat = jest.fn().mockResolvedValue(undefined);
jest.mock('../utils/helpers', () => ({
    recordHeartbeat: (...a: unknown[]) => mockRecordHeartbeat(...a),
}));

// ── 가짜 Firestore ──
type Where = [string, string, unknown];
interface FakeOrg { id: string; data: Record<string, unknown> }

const state: {
    briefingOrgs: FakeOrg[];
    targetOrgs: FakeOrg[];
    orgsWithMembers: Set<string>;
    holidays: Record<string, Record<string, string>> | null;
    sentLog: Record<string, unknown> | null;
    newOrgsCount: number;
    newFeedbacksCount: number;
    briefingThrows: boolean;
} = {
    briefingOrgs: [], targetOrgs: [], orgsWithMembers: new Set(), holidays: null,
    sentLog: null, newOrgsCount: 0, newFeedbacksCount: 0, briefingThrows: false,
};

/** 기록된 쿼리: [컬렉션, where 목록] */
const queries: Array<{ col: string; wheres: Where[]; count: boolean }> = [];
const docGets: string[] = [];
const mockLogSet = jest.fn().mockResolvedValue(undefined);

function snapOf(orgs: FakeOrg[]) {
    return {
        empty: orgs.length === 0,
        docs: orgs.map(o => ({ id: o.id, data: () => o.data })),
    };
}

function runQuery(col: string, wheres: Where[]) {
    if (col === 'organizations') {
        const ops = wheres.map(w => w[1]);
        if (ops.includes('>')) {
            if (state.briefingThrows) throw new Error('briefing index missing');
            return snapOf(state.briefingOrgs);
        }
        return snapOf(state.targetOrgs);
    }
    if (col === 'users') {
        const orgId = wheres.find(w => w[0] === 'organizationId')?.[2] as string;
        return { empty: !state.orgsWithMembers.has(orgId), docs: [] };
    }
    throw new Error(`예상하지 못한 쿼리: ${col}`);
}

function makeQuery(col: string, wheres: Where[] = []): Record<string, unknown> {
    return {
        where: (f: string, op: string, v: unknown) => makeQuery(col, [...wheres, [f, op, v]]),
        limit: () => makeQuery(col, wheres),
        count: () => ({
            get: async () => {
                queries.push({ col, wheres, count: true });
                const count = col === 'feedbacks' ? state.newFeedbacksCount : state.newOrgsCount;
                return { data: () => ({ count }) };
            },
        }),
        get: async () => {
            queries.push({ col, wheres, count: false });
            return runQuery(col, wheres);
        },
        doc: (id: string) => makeDoc(`${col}/${id}`),
    };
}

function makeDoc(path: string): Record<string, unknown> {
    return {
        get: async () => {
            docGets.push(path);
            if (path === 'system/holidays') {
                return { exists: state.holidays !== null, data: () => state.holidays };
            }
            if (path.startsWith('system/alimtalkLogs/inactiveOrg/')) {
                return { exists: state.sentLog !== null, data: () => state.sentLog };
            }
            return { exists: false, data: () => undefined };
        },
        set: (data: unknown) => mockLogSet(path, data),
        collection: (c: string) => makeQuery(`${path}/${c}`),
    };
}

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ collection: (c: string) => makeQuery(c) }),
}));

import { sendInactiveOrgAlimtalkScheduled } from '../handlers/scheduled/sendInactiveOrgAlimtalkScheduled';

const run = sendInactiveOrgAlimtalkScheduled as unknown as () => Promise<void>;

/** 대상 주간 org 쿼리(지난주 범위)만 골라낸다 */
const targetOrgQuery = () => queries.find(q => q.col === 'organizations' && !q.count && q.wheres.some(w => w[1] === '>='));
const discordTitles = () => mockSendDiscordAlert.mock.calls.map(c => c[0].title as string);
const summaryAlert = () => mockSendDiscordAlert.mock.calls.map(c => c[0]).find(a => a.title.includes('미활성 기관 알림톡 발송 완료'));

function org(id: string, data: Record<string, unknown>): FakeOrg {
    return { id, data: { name: `${id}-기관`, inviteCode: `CODE-${id}`, applicantPhone: '010-0000-0000', ...data } };
}

describe('sendInactiveOrgAlimtalkScheduled', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSendDiscordAlert.mockResolvedValue(undefined);
        mockSendReminder.mockResolvedValue({ success: true });
        queries.length = 0;
        docGets.length = 0;
        Object.assign(state, {
            briefingOrgs: [], targetOrgs: [], orgsWithMembers: new Set(), holidays: null,
            sentLog: null, newOrgsCount: 0, newFeedbacksCount: 0, briefingThrows: false,
        });
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
        jest.useFakeTimers();
        // 2026-11-24(화) 14:00 KST
        jest.setSystemTime(new Date('2026-11-24T05:00:00Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    describe('발송 건너뛰기', () => {
        it('오늘이 공휴일이면 대상 조회·발송·발송 기록을 하지 않는다', async () => {
            state.holidays = { '2026': { '2026-11-24': '임시공휴일' } };
            state.targetOrgs = [org('o1', {})];

            await run();

            expect(targetOrgQuery()).toBeUndefined();
            expect(mockSendReminder).not.toHaveBeenCalled();
            expect(mockLogSet).not.toHaveBeenCalled();
        });

        it('다른 날짜만 공휴일이면 그대로 발송한다', async () => {
            state.holidays = { '2026': { '2026-12-25': '성탄절' } };
            state.targetOrgs = [org('o1', {})];

            await run();

            expect(mockSendReminder).toHaveBeenCalledTimes(1);
        });

        it('이번 주에 이미 보냈으면 다시 보내지 않는다 (주 1회)', async () => {
            state.sentLog = { sent: true };
            state.targetOrgs = [org('o1', {})];

            await run();

            expect(mockSendReminder).not.toHaveBeenCalled();
            expect(mockLogSet).not.toHaveBeenCalled();
        });

        it('발송 기록 문서가 있어도 sent가 아니면 발송한다', async () => {
            state.sentLog = { sent: false };
            state.targetOrgs = [org('o1', {})];

            await run();

            expect(mockSendReminder).toHaveBeenCalledTimes(1);
        });
    });

    describe('주간 키와 대상 기간 (KST)', () => {
        it('화요일 실행은 이번 주 월요일 키로 기록하고 지난주 월~일 가입 기관을 찾는다', async () => {
            await run();

            expect(docGets).toContain('system/alimtalkLogs/inactiveOrg/2026-11-23');
            const q = targetOrgQuery()!;
            expect(q.wheres).toEqual([
                ['status', '==', 'approved'],
                ['createdAt', '>=', new Date('2026-11-16T00:00:00+09:00')],
                ['createdAt', '<=', new Date('2026-11-22T23:59:59.999+09:00')],
            ]);
            expect(mockLogSet).toHaveBeenCalledWith(
                'system/alimtalkLogs/inactiveOrg/2026-11-23',
                expect.objectContaining({ sent: true, targetWeek: '2026-11-16 ~ 2026-11-22' }),
            );
        });

        it('KST 월요일 0시 30분(UTC는 아직 일요일)도 새 주로 본다', async () => {
            jest.setSystemTime(new Date('2026-11-22T15:30:00Z')); // 2026-11-23(월) 00:30 KST

            await run();

            expect(docGets).toContain('system/alimtalkLogs/inactiveOrg/2026-11-23');
            expect(mockLogSet.mock.calls[0][1].targetWeek).toBe('2026-11-16 ~ 2026-11-22');
        });

        it('일요일 실행은 그 주 월요일(6일 전)에 묶인다', async () => {
            jest.setSystemTime(new Date('2026-11-29T05:00:00Z')); // 2026-11-29(일) 14:00 KST

            await run();

            expect(docGets).toContain('system/alimtalkLogs/inactiveOrg/2026-11-23');
        });

        it('공휴일 키는 KST 날짜다 — UTC로는 전날인 시각에도 오늘 공휴일을 알아본다', async () => {
            jest.setSystemTime(new Date('2026-12-24T15:30:00Z')); // 2026-12-25 00:30 KST
            state.holidays = { '2026': { '2026-12-25': '성탄절' } };
            state.targetOrgs = [org('o1', {})];

            await run();

            expect(mockSendReminder).not.toHaveBeenCalled();
        });

        it('월요일 발송은 holidaySkipped=false, 화요일 이후 발송은 true로 남긴다', async () => {
            jest.setSystemTime(new Date('2026-11-23T05:00:00Z')); // 월요일
            await run();
            expect(mockLogSet.mock.calls[0][1].holidaySkipped).toBe(false);

            mockLogSet.mockClear();
            jest.setSystemTime(new Date('2026-11-24T05:00:00Z')); // 화요일
            await run();
            expect(mockLogSet.mock.calls[0][1].holidaySkipped).toBe(true);
        });
    });

    describe('대상 선정과 발송', () => {
        it('직원이 이미 있는 기관은 건너뛴다 — 기관 ID로 users를 조회한다', async () => {
            state.targetOrgs = [org('active', {}), org('idle', {})];
            state.orgsWithMembers = new Set(['active']);

            await run();

            const userQueries = queries.filter(q => q.col === 'users').map(q => q.wheres);
            expect(userQueries).toContainEqual([['organizationId', '==', 'active']]);
            expect(userQueries).toContainEqual([['organizationId', '==', 'idle']]);
            expect(mockSendReminder).toHaveBeenCalledTimes(1);
            expect(mockSendReminder).toHaveBeenCalledWith('010-0000-0000', 'idle-기관', 'idle-기관', 'CODE-idle');
        });

        it('신청자 번호·이름을 기관 대표 번호·기관명보다 먼저 쓴다', async () => {
            state.targetOrgs = [
                org('o1', { applicantPhone: '010-1111-1111', phone: '02-000-0000', applicantName: '홍담당' }),
                org('o2', { applicantPhone: undefined, phone: '02-222-2222' }),
            ];

            await run();

            expect(mockSendReminder).toHaveBeenCalledWith('010-1111-1111', '홍담당', 'o1-기관', 'CODE-o1');
            expect(mockSendReminder).toHaveBeenCalledWith('02-222-2222', 'o2-기관', 'o2-기관', 'CODE-o2');
        });

        it('번호·초대코드가 없으면 보내지 않고 사유를 기록한다', async () => {
            state.targetOrgs = [
                org('nophone', { applicantPhone: undefined }),
                org('nocode', { inviteCode: '' }),
            ];

            await run();

            expect(mockSendReminder).not.toHaveBeenCalled();
            const log = mockLogSet.mock.calls[0][1];
            expect(log).toMatchObject({ sentCount: 0, failCount: 1, noPhoneCount: 1 });
            expect(log.results).toEqual([
                { orgName: 'nophone-기관', phone: '-', success: false, message: '전화번호 없음' },
                { orgName: 'nocode-기관', phone: '010-0000-0000', success: false, message: '초대코드 없음' },
            ]);
        });

        it('발송 성공·실패·예외를 각각 집계하고 예외가 나도 다음 기관을 계속 보낸다', async () => {
            state.targetOrgs = [org('ok', {}), org('fail', {}), org('boom', {}), org('ok2', {})];
            mockSendReminder
                .mockResolvedValueOnce({ success: true })
                .mockResolvedValueOnce({ success: false, message: '템플릿 불일치' })
                .mockRejectedValueOnce(new Error('timeout'))
                .mockResolvedValueOnce({ success: true });

            await run();

            expect(mockSendReminder).toHaveBeenCalledTimes(4);
            const log = mockLogSet.mock.calls[0][1];
            expect(log).toMatchObject({ sent: true, sentCount: 2, failCount: 2, noPhoneCount: 0 });
            expect(log.results.map((r: { success: boolean; message?: string }) => [r.success, r.message])).toEqual([
                [true, undefined],
                [false, '템플릿 불일치'],
                [false, 'timeout'],
                [true, undefined],
            ]);
            expect(summaryAlert().fields).toEqual([
                { name: '발송 성공', value: '2건', inline: true },
                { name: '발송 실패', value: '2건', inline: true },
                { name: '전화번호 없음', value: '0건', inline: true },
            ]);
        });

        it('대상이 없어도 이번 주 발송 완료로 기록한다 — 같은 주에 다시 돌지 않게', async () => {
            await run();

            expect(mockSendReminder).not.toHaveBeenCalled();
            expect(mockLogSet).toHaveBeenCalledWith(
                'system/alimtalkLogs/inactiveOrg/2026-11-23',
                expect.objectContaining({ sent: true, sentCount: 0, failCount: 0, noPhoneCount: 0, results: [] }),
            );
            expect(summaryAlert()).toBeDefined();
        });

        // 현재 동작 고정: 전부 실패해도 sent=true가 남아 그 주에는 재시도하지 않는다.
        // (일시 장애로 전부 실패한 주는 다음 주까지 리마인드가 나가지 않는다 — 의도인지 확인 필요)
        it('전부 실패해도 그 주는 발송 완료로 기록된다 (현재 동작)', async () => {
            state.targetOrgs = [org('o1', {})];
            mockSendReminder.mockResolvedValue({ success: false, message: '프록시 환경변수 미설정' });

            await run();

            expect(mockLogSet.mock.calls[0][1]).toMatchObject({ sent: true, sentCount: 0, failCount: 1 });
        });
    });

    describe('디스코드 브리핑', () => {
        it('가입 3일 경과·직원 없는 승인 기관을 모아 한 번 알린다', async () => {
            state.briefingOrgs = [
                org('b1', { name: '느린기관', createdAt: { seconds: Date.UTC(2026, 10, 20) / 1000 } }),
                org('b2', { name: '빠른기관' }),
            ];
            state.orgsWithMembers = new Set(['b2']);

            await run();

            const alert = mockSendDiscordAlert.mock.calls.map(c => c[0]).find(a => a.title.includes('비활성 기관'));
            expect(alert.title).toContain('(1곳)');
            expect(alert.description).toContain('느린기관');
            expect(alert.description).not.toContain('빠른기관');
            const briefingQuery = queries.find(q => q.col === 'organizations' && q.wheres.some(w => w[1] === '>'))!;
            expect(briefingQuery.wheres[0]).toEqual(['status', '==', 'approved']);
        });

        it('직원이 모두 있으면 비활성 알림을 보내지 않는다', async () => {
            state.briefingOrgs = [org('b1', {})];
            state.orgsWithMembers = new Set(['b1']);

            await run();

            expect(discordTitles().some(t => t.includes('비활성 기관'))).toBe(false);
        });

        it('월요일에만 주간 리포트(신규 기관·의견 건수)를 보낸다', async () => {
            jest.setSystemTime(new Date('2026-11-23T05:00:00Z')); // 월요일 14:00 KST
            state.newOrgsCount = 4;
            state.newFeedbacksCount = 7;

            await run();

            const weekly = mockSendDiscordAlert.mock.calls.map(c => c[0]).find(a => a.title.includes('주간 리포트'));
            expect(weekly.fields).toEqual([
                { name: '✨ 신규 가입 기관', value: '4 곳', inline: true },
                { name: '💬 접수된 고객 의견', value: '7 건', inline: true },
            ]);
            expect(queries.filter(q => q.count).map(q => q.col)).toEqual(['organizations', 'feedbacks']);
        });

        it('화요일에는 주간 리포트를 보내지 않는다', async () => {
            await run();

            expect(discordTitles().some(t => t.includes('주간 리포트'))).toBe(false);
            expect(queries.some(q => q.count)).toBe(false);
        });

        it('브리핑이 끝나면 heartbeat를 찍는다', async () => {
            await run();

            expect(mockRecordHeartbeat).toHaveBeenCalledWith('discordBriefing');
        });

        it('브리핑이 실패해도 알림톡 발송은 계속한다 (heartbeat는 찍지 않는다)', async () => {
            state.briefingThrows = true;
            state.targetOrgs = [org('o1', {})];

            await run();

            expect(mockRecordHeartbeat).not.toHaveBeenCalled();
            expect(mockSendReminder).toHaveBeenCalledTimes(1);
            expect(mockLogSet).toHaveBeenCalled();
        });

        it('브리핑 디스코드 전송 실패는 삼키고 다음 단계로 간다', async () => {
            state.briefingOrgs = [org('b1', {})];
            mockSendDiscordAlert
                .mockRejectedValueOnce(new Error('discord 429'))
                .mockResolvedValue(undefined);

            await run();

            expect(mockRecordHeartbeat).toHaveBeenCalledWith('discordBriefing');
            expect(mockLogSet).toHaveBeenCalled();
        });
    });
});
