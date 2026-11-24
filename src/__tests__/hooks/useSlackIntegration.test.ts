import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

/**
 * useSlackIntegration — 설정 화면의 Slack 연결 상태·연결·해제·진단.
 * 고정하는 계약:
 *  - 모든 조회·조작은 콜러블 경유(봇 토큰은 프론트에 오지 않는다)
 *  - OAuth 복귀 쿼리(?slack=connected|error&reason=)는 토스트 한 번 + URL에서 제거(새로고침 재발 방지)
 *  - 연결돼 있으면 마운트 때 진단을 조용히 한 번 돌린다
 *  - 상태 조회 실패는 "연결 안 됨"으로 접는다(무한 로딩 방지)
 */
const mockShowToast = vi.fn();
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const callables: Record<string, ReturnType<typeof vi.fn<(...a: unknown[]) => Promise<unknown>>>> = {
    getSlackConnectionStatus: vi.fn(),
    diagnoseSlackConnection: vi.fn(),
    getSlackInstallUrl: vi.fn(),
    disconnectSlack: vi.fn(),
};
vi.mock('firebase/functions', () => ({
    httpsCallable: (_fns: unknown, name: string) => (...a: unknown[]) => callables[name](...a),
}));
vi.mock('@/lib/firebase', () => ({ firebaseFunctions: {} }));

import { useSlackIntegration } from '@/hooks/useSlackIntegration';

const STAFF_ALL_MATCHED = [
    { name: '김직원', email: 'kim@org.kr', matched: true },
    { name: '이직원', email: 'lee@org.kr', matched: true },
];
const STAFF_TWO_UNMATCHED = [
    { name: '김직원', email: 'kim@org.kr', matched: true },
    { name: '이직원', email: 'lee@org.kr', matched: false },
    { name: '박직원', email: 'park@org.kr', matched: false },
];

/** 상태 조회가 끝날 때까지 기다린다 (status: null = 로딩 중) */
async function renderReady() {
    const hook = renderHook(() => useSlackIntegration());
    await waitFor(() => expect(hook.result.current.status).not.toBeNull());
    return hook;
}

describe('useSlackIntegration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.history.replaceState(null, '', '/admin/settings');
        callables.getSlackConnectionStatus.mockResolvedValue({ data: { connected: false } });
        callables.diagnoseSlackConnection.mockResolvedValue({ data: { ok: true, staff: STAFF_ALL_MATCHED } });
        callables.getSlackInstallUrl.mockResolvedValue({ data: { url: '#slack-install' } });
        callables.disconnectSlack.mockResolvedValue({ data: { ok: true } });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        window.history.replaceState(null, '', '/');
    });

    describe('마운트', () => {
        it('연결 안 됨이면 상태만 읽고 진단은 하지 않는다', async () => {
            const { result } = await renderReady();

            expect(result.current.status).toEqual({ connected: false });
            expect(callables.diagnoseSlackConnection).not.toHaveBeenCalled();
            expect(mockShowToast).not.toHaveBeenCalled();
        });

        it('연결돼 있으면 진단을 조용히 한 번 돌려 직원 준비 상태를 채운다 (토스트 없음)', async () => {
            callables.getSlackConnectionStatus.mockResolvedValue({ data: { connected: true, teamName: '복지관' } });

            const { result } = await renderReady();

            await waitFor(() => expect(result.current.staff).toEqual(STAFF_ALL_MATCHED));
            expect(callables.diagnoseSlackConnection).toHaveBeenCalledTimes(1);
            expect(result.current.diagnosing).toBe(false);
            expect(mockShowToast).not.toHaveBeenCalled();
        });

        it('상태 조회가 실패하면 연결 안 됨으로 접는다', async () => {
            callables.getSlackConnectionStatus.mockRejectedValue(new Error('internal'));

            const { result } = await renderReady();

            expect(result.current.status).toEqual({ connected: false });
            expect(callables.diagnoseSlackConnection).not.toHaveBeenCalled();
        });

        it('연결 성공 복귀 쿼리면 축하 토스트를 띄우고 쿼리를 지운다 (다른 쿼리는 남긴다)', async () => {
            window.history.replaceState(null, '', '/admin/settings?tab=integrations&slack=connected');

            await renderReady();

            expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('연결되었습니다'), 'success');
            expect(window.location.pathname).toBe('/admin/settings');
            expect(window.location.search).toBe('?tab=integrations');
        });

        it.each([
            ['already_linked', '이 Slack 워크스페이스는 이미 다른 기관에 연결되어 있습니다.'],
            ['cancelled', 'Slack 연결이 취소되었습니다.'],
            ['used_or_expired', '연결 요청이 만료되었습니다. 다시 시도해주세요.'],
        ])('오류 복귀(reason=%s)는 그 사유의 안내를 띄우고 slack·reason을 지운다', async (reason, message) => {
            window.history.replaceState(null, '', `/admin/settings?slack=error&reason=${reason}`);

            await renderReady();

            expect(mockShowToast).toHaveBeenCalledWith(message, 'error');
            expect(window.location.search).toBe('');
        });

        it('모르는 사유나 사유 없는 오류는 일반 서버 오류 안내로 보인다', async () => {
            window.history.replaceState(null, '', '/admin/settings?slack=error&reason=weird');
            await renderReady();
            expect(mockShowToast).toHaveBeenLastCalledWith('연결 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 'error');

            mockShowToast.mockClear();
            window.history.replaceState(null, '', '/admin/settings?slack=error');
            await renderReady();
            expect(mockShowToast).toHaveBeenLastCalledWith('연결 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 'error');
        });

        it('다시 렌더해도 복귀 토스트는 한 번만 뜬다', async () => {
            window.history.replaceState(null, '', '/admin/settings?slack=connected');
            const { rerender } = await renderReady();

            rerender();

            expect(mockShowToast).toHaveBeenCalledTimes(1);
        });
    });

    describe('diagnose', () => {
        it('모두 매칭되면 성공 토스트와 true', async () => {
            const { result } = await renderReady();

            let ok: boolean | undefined;
            await act(async () => { ok = await result.current.diagnose(); });

            expect(ok).toBe(true);
            expect(result.current.staff).toEqual(STAFF_ALL_MATCHED);
            expect(mockShowToast).toHaveBeenCalledWith('연결 정상 — 모든 직원이 준비되었습니다.', 'success');
        });

        it('매칭 안 된 직원 수를 경고로 알린다', async () => {
            callables.diagnoseSlackConnection.mockResolvedValue({ data: { ok: true, staff: STAFF_TWO_UNMATCHED } });
            const { result } = await renderReady();

            await act(async () => { await result.current.diagnose(); });

            expect(mockShowToast).toHaveBeenCalledWith('연결 정상 — 직원 2명의 Slack 이메일이 일치하지 않습니다.', 'warning');
        });

        it('서버가 준 "연결된…" 안내는 그대로 보여 주고 직원 목록을 비운다', async () => {
            callables.diagnoseSlackConnection.mockRejectedValue(new Error('연결된 Slack 워크스페이스가 없습니다.'));
            const { result } = await renderReady();

            let ok: boolean | undefined;
            await act(async () => { ok = await result.current.diagnose(); });

            expect(ok).toBe(false);
            expect(result.current.staff).toBeNull();
            expect(result.current.diagnosing).toBe(false);
            expect(mockShowToast).toHaveBeenCalledWith('연결된 Slack 워크스페이스가 없습니다.', 'error');
        });

        it('그 밖의 오류는 재연결 안내로 바꾼다 (Error가 아닌 값도)', async () => {
            callables.diagnoseSlackConnection.mockRejectedValue('invalid_auth');
            const { result } = await renderReady();

            await act(async () => { await result.current.diagnose(); });

            expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('연결을 해제하고 다시 연결해주세요'), 'error');
        });

        it('silent면 성공·실패 모두 토스트를 띄우지 않는다', async () => {
            const { result } = await renderReady();

            await act(async () => { await result.current.diagnose({ silent: true }); });
            callables.diagnoseSlackConnection.mockRejectedValue(new Error('x'));
            await act(async () => { await result.current.diagnose({ silent: true }); });

            expect(mockShowToast).not.toHaveBeenCalled();
        });
    });

    describe('connect', () => {
        it('서명된 설치 URL로 이동하고 연결 중 상태를 유지한다', async () => {
            const { result } = await renderReady();

            await act(async () => { await result.current.connect(); });

            expect(callables.getSlackInstallUrl).toHaveBeenCalledTimes(1);
            expect(window.location.hash).toBe('#slack-install');
            expect(result.current.connecting).toBe(true);
        });

        it('설치 URL 발급이 실패하면 오류 토스트를 띄우고 연결 중 상태를 푼다', async () => {
            callables.getSlackInstallUrl.mockRejectedValue(new Error('permission-denied'));
            const { result } = await renderReady();

            await act(async () => { await result.current.connect(); });

            expect(result.current.connecting).toBe(false);
            expect(mockShowToast).toHaveBeenCalledWith('연결을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.', 'error');
        });
    });

    describe('disconnect', () => {
        it('해제하면 연결 안 됨으로 바꾸고 직원 목록을 비운다', async () => {
            callables.getSlackConnectionStatus.mockResolvedValue({ data: { connected: true } });
            const { result } = await renderReady();
            await waitFor(() => expect(result.current.staff).not.toBeNull());

            await act(async () => { await result.current.disconnect(); });

            expect(callables.disconnectSlack).toHaveBeenCalledTimes(1);
            expect(result.current.status).toEqual({ connected: false });
            expect(result.current.staff).toBeNull();
            expect(result.current.disconnecting).toBe(false);
            expect(mockShowToast).toHaveBeenCalledWith('Slack 연결을 해제했습니다.', 'success');
        });

        it('해제가 실패하면 상태를 그대로 두고 오류 토스트를 낸다', async () => {
            callables.getSlackConnectionStatus.mockResolvedValue({ data: { connected: true } });
            callables.disconnectSlack.mockRejectedValue(new Error('internal'));
            const { result } = await renderReady();
            // 마운트 때 도는 조용한 진단이 끝날 때까지 기다린다 — act 밖 상태 갱신 방지
            await waitFor(() => expect(result.current.staff).not.toBeNull());

            await act(async () => { await result.current.disconnect(); });

            expect(result.current.status).toEqual({ connected: true });
            expect(result.current.disconnecting).toBe(false);
            expect(mockShowToast).toHaveBeenCalledWith('연결 해제에 실패했습니다. 잠시 후 다시 시도해주세요.', 'error');
        });
    });
});
