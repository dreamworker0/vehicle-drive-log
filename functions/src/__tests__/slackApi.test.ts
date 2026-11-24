/**
 * slackApi.test.ts — fetch 기반 Slack Web API 최소 클라이언트
 *
 * 고정하는 계약:
 *  - 쓰기 계열은 JSON 본문, **읽기 계열은 form-urlencoded** (JSON이면 Slack이 인자를 못 읽어
 *    users.info가 user 없이 호출되어 user_not_found가 난다 — 실제로 겪은 회귀)
 *  - 실패 응답(ok:false)은 예외 없이 null/false로 접힌다 — 호출부가 조용히 skip할 수 있게
 *  - users.list는 봇·삭제 계정을 빼고 소문자 이메일만 모으며, 최대 5페이지에서 멈춘다
 * 로그 출력은 단언하지 않는다(로거 교체와 무관하게 유지).
 */
jest.mock('../utils/helpers', () => ({ log: jest.fn() }));

import {
    postMessage,
    addReaction,
    authTest,
    getSlackUserInfo,
    lookupUserByEmail,
    oauthV2Access,
    authRevoke,
    listSlackEmails,
    respondToUrl,
} from '../services/slack/slackApi';

const mockFetch = jest.fn();

function slackReply(body: Record<string, unknown>) {
    return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

/** n번째 fetch 호출의 [url, init] */
const call = (i = 0) => mockFetch.mock.calls[i] as [string, { method: string; headers: Record<string, string>; body: string }];

describe('slackApi', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    describe('쓰기 계열 (JSON 본문 + Bearer 토큰)', () => {
        it('postMessage는 chat.postMessage로 채널·텍스트를 JSON으로 보낸다', async () => {
            mockFetch.mockResolvedValue(slackReply({ ok: true }));

            await expect(postMessage('xoxb-1', 'D123', '안녕하세요')).resolves.toBe(true);

            const [url, init] = call();
            expect(url).toBe('https://slack.com/api/chat.postMessage');
            expect(init.method).toBe('POST');
            expect(init.headers).toEqual({
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': 'Bearer xoxb-1',
            });
            expect(JSON.parse(init.body)).toEqual({ channel: 'D123', text: '안녕하세요' });
        });

        it('postMessage는 blocks가 있을 때만 싣는다', async () => {
            mockFetch.mockResolvedValue(slackReply({ ok: true }));
            const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: '*굵게*' } }];

            await postMessage('xoxb-1', 'D123', '폴백', blocks);

            expect(JSON.parse(call()[1].body)).toEqual({ channel: 'D123', text: '폴백', blocks });
        });

        it('postMessage는 ok:false면 예외 없이 false를 돌려준다', async () => {
            mockFetch.mockResolvedValue(slackReply({ ok: false, error: 'channel_not_found' }));

            await expect(postMessage('xoxb-1', 'D404', '테스트')).resolves.toBe(false);
        });

        it('addReaction은 reactions.add로 채널·타임스탬프·이모지 이름을 보낸다', async () => {
            mockFetch.mockResolvedValue(slackReply({ ok: false, error: 'already_reacted' }));

            await expect(addReaction('xoxb-1', 'C1', '1700000000.000100', 'eyes')).resolves.toBe(false);

            expect(call()[0]).toBe('https://slack.com/api/reactions.add');
            expect(JSON.parse(call()[1].body)).toEqual({ channel: 'C1', timestamp: '1700000000.000100', name: 'eyes' });
        });
    });

    describe('authTest', () => {
        it('팀·봇 신원을 꺼내 돌려준다', async () => {
            mockFetch.mockResolvedValue(slackReply({ ok: true, team_id: 'T1', team: '복지관', user_id: 'U_BOT' }));

            await expect(authTest('xoxb-1')).resolves.toEqual({
                ok: true, teamId: 'T1', team: '복지관', botUserId: 'U_BOT', error: undefined,
            });
            expect(call()[0]).toBe('https://slack.com/api/auth.test');
        });

        it('실패하면 필드는 null, 오류 코드는 그대로 전달한다', async () => {
            mockFetch.mockResolvedValue(slackReply({ ok: false, error: 'invalid_auth' }));

            await expect(authTest('xoxb-bad')).resolves.toEqual({
                ok: false, teamId: null, team: null, botUserId: null, error: 'invalid_auth',
            });
        });
    });

    describe('읽기 계열 (form-urlencoded)', () => {
        it('getSlackUserInfo는 users.info를 폼 인코딩으로 호출한다 — JSON이면 user 인자가 빠진다', async () => {
            mockFetch.mockResolvedValue(slackReply({
                ok: true, user: { profile: { email: 'kim@org.kr', real_name: '김직원' } },
            }));

            await expect(getSlackUserInfo('xoxb-1', 'U123')).resolves.toEqual({ email: 'kim@org.kr', realName: '김직원' });

            const [url, init] = call();
            expect(url).toBe('https://slack.com/api/users.info');
            expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded; charset=utf-8');
            expect(init.headers['Authorization']).toBe('Bearer xoxb-1');
            expect(init.body).toBe('user=U123');
        });

        it('getSlackUserInfo는 실패하거나 프로필이 비면 null로 채운다', async () => {
            mockFetch.mockResolvedValueOnce(slackReply({ ok: false, error: 'user_not_found' }));
            await expect(getSlackUserInfo('xoxb-1', 'U404')).resolves.toEqual({ email: null, realName: null });

            mockFetch.mockResolvedValueOnce(slackReply({ ok: true, user: {} }));
            await expect(getSlackUserInfo('xoxb-1', 'U1')).resolves.toEqual({ email: null, realName: null });
        });

        it('lookupUserByEmail은 이메일을 URL 인코딩해 보내고 사용자 ID를 돌려준다', async () => {
            mockFetch.mockResolvedValue(slackReply({ ok: true, user: { id: 'U777' } }));

            await expect(lookupUserByEmail('xoxb-1', 'a+b@org.kr')).resolves.toBe('U777');

            expect(call()[0]).toBe('https://slack.com/api/users.lookupByEmail');
            expect(call()[1].body).toBe('email=a%2Bb%40org.kr');
        });

        it.each(['users_not_found', 'missing_scope', 'ratelimited'])(
            'lookupUserByEmail은 %s 응답이면 null로 skip한다',
            async (error) => {
                mockFetch.mockResolvedValue(slackReply({ ok: false, error }));

                await expect(lookupUserByEmail('xoxb-1', 'x@org.kr')).resolves.toBeNull();
            },
        );

        it('lookupUserByEmail은 ok여도 user.id가 없으면 null이다', async () => {
            mockFetch.mockResolvedValue(slackReply({ ok: true, user: {} }));

            await expect(lookupUserByEmail('xoxb-1', 'x@org.kr')).resolves.toBeNull();
        });
    });

    describe('oauthV2Access', () => {
        it('앱 크리덴셜과 코드를 폼으로 보내고 봇 토큰·팀 정보를 돌려준다 (Authorization 헤더 없음)', async () => {
            mockFetch.mockResolvedValue(slackReply({
                ok: true, access_token: 'xoxb-new', team: { id: 'T9', name: '희망센터' },
                bot_user_id: 'U_BOT9', scope: 'chat:write,users:read.email',
            }));

            const result = await oauthV2Access('cid', 'secret', 'code-1', 'https://app.test/cb');

            expect(result).toEqual({
                ok: true, accessToken: 'xoxb-new', teamId: 'T9', teamName: '희망센터',
                botUserId: 'U_BOT9', scope: 'chat:write,users:read.email', error: undefined,
            });
            const [url, init] = call();
            expect(url).toBe('https://slack.com/api/oauth.v2.access');
            expect(init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' });
            expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
                client_id: 'cid', client_secret: 'secret', code: 'code-1', redirect_uri: 'https://app.test/cb',
            });
        });

        it('교환에 실패하면 토큰·팀은 null, 오류 코드를 전달한다', async () => {
            mockFetch.mockResolvedValue(slackReply({ ok: false, error: 'invalid_code' }));

            await expect(oauthV2Access('cid', 'secret', 'used', 'https://app.test/cb')).resolves.toEqual({
                ok: false, accessToken: null, teamId: null, teamName: null,
                botUserId: null, scope: null, error: 'invalid_code',
            });
        });
    });

    describe('authRevoke', () => {
        it('ok이면서 revoked일 때만 true다', async () => {
            mockFetch.mockResolvedValueOnce(slackReply({ ok: true, revoked: true }));
            await expect(authRevoke('xoxb-1')).resolves.toBe(true);
            expect(call()[0]).toBe('https://slack.com/api/auth.revoke');

            mockFetch.mockResolvedValueOnce(slackReply({ ok: true, revoked: false }));
            await expect(authRevoke('xoxb-1')).resolves.toBe(false);

            mockFetch.mockResolvedValueOnce(slackReply({ ok: false, error: 'token_revoked' }));
            await expect(authRevoke('xoxb-1')).resolves.toBe(false);
        });
    });

    describe('listSlackEmails', () => {
        it('봇·삭제 계정과 이메일 없는 계정을 빼고 소문자로 모은다', async () => {
            mockFetch.mockResolvedValue(slackReply({
                ok: true,
                members: [
                    { profile: { email: 'Kim@Org.KR' } },
                    { deleted: true, profile: { email: 'gone@org.kr' } },
                    { is_bot: true, profile: { email: 'bot@org.kr' } },
                    { profile: {} },
                    {},
                    { profile: { email: 'kim@org.kr' } },
                ],
                response_metadata: { next_cursor: '' },
            }));

            const result = await listSlackEmails('xoxb-1');

            expect(result.ok).toBe(true);
            expect([...result.emails]).toEqual(['kim@org.kr']);
            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(call()[1].body).toBe('limit=200');
        });

        it('next_cursor를 따라 다음 페이지를 읽는다 (공백 커서는 끝으로 본다)', async () => {
            mockFetch
                .mockResolvedValueOnce(slackReply({
                    ok: true, members: [{ profile: { email: 'a@org.kr' } }],
                    response_metadata: { next_cursor: 'cur-2' },
                }))
                .mockResolvedValueOnce(slackReply({
                    ok: true, members: [{ profile: { email: 'b@org.kr' } }],
                    response_metadata: { next_cursor: '  ' },
                }));

            const result = await listSlackEmails('xoxb-1');

            expect([...result.emails].sort()).toEqual(['a@org.kr', 'b@org.kr']);
            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(Object.fromEntries(new URLSearchParams(call(1)[1].body))).toEqual({ limit: '200', cursor: 'cur-2' });
        });

        it('최대 5페이지에서 멈춘다 — 커서가 계속 와도 호출 수를 제한한다', async () => {
            let n = 0;
            mockFetch.mockImplementation(async () => slackReply({
                ok: true, members: [{ profile: { email: `u${n++}@org.kr` } }],
                response_metadata: { next_cursor: 'more' },
            }));

            const result = await listSlackEmails('xoxb-1');

            expect(mockFetch).toHaveBeenCalledTimes(5);
            expect(result.ok).toBe(true);
            expect(result.emails.size).toBe(5);
        });

        it('중간 페이지가 실패하면 ok:false와 오류 코드, 그때까지 모은 이메일을 돌려준다', async () => {
            mockFetch
                .mockResolvedValueOnce(slackReply({
                    ok: true, members: [{ profile: { email: 'a@org.kr' } }],
                    response_metadata: { next_cursor: 'cur-2' },
                }))
                .mockResolvedValueOnce(slackReply({ ok: false, error: 'missing_scope' }));

            const result = await listSlackEmails('xoxb-1');

            expect(result.ok).toBe(false);
            expect(result.error).toBe('missing_scope');
            expect([...result.emails]).toEqual(['a@org.kr']);
        });

        it('members가 없는 응답도 빈 목록으로 처리한다', async () => {
            mockFetch.mockResolvedValue(slackReply({ ok: true }));

            const result = await listSlackEmails('xoxb-1');

            expect(result).toEqual({ ok: true, emails: new Set() });
        });
    });

    describe('respondToUrl', () => {
        it('response_url에 페이로드를 JSON으로 POST한다 (봇 토큰 없이)', async () => {
            mockFetch.mockResolvedValue({ ok: true, status: 200 });
            const payload = { text: '처리했습니다', replace_original: true };

            await respondToUrl('https://hooks.slack.com/actions/T/1/abc', payload);

            const [url, init] = call();
            expect(url).toBe('https://hooks.slack.com/actions/T/1/abc');
            expect(init.headers).toEqual({ 'Content-Type': 'application/json; charset=utf-8' });
            expect(JSON.parse(init.body)).toEqual(payload);
        });

        it('HTTP 실패여도 던지지 않는다 — 응답 교체는 비필수', async () => {
            mockFetch.mockResolvedValue({ ok: false, status: 404 });

            await expect(respondToUrl('https://hooks.slack.com/x', { text: 'x' })).resolves.toBeUndefined();
        });
    });
});
