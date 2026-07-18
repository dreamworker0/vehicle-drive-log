/**
 * useSlackIntegration — 설정 화면의 Slack 연결 상태·연결·해제·진단 로직
 *
 * integrations 문서는 Rules로 클라이언트 접근이 차단돼 있어(봇 토큰 보관)
 * 모든 조회·조작은 콜러블을 경유한다. 토큰은 프론트에 절대 오지 않는다.
 * OAuth 콜백이 /admin/settings?slack=connected|error 로 복귀시키므로
 * 마운트 시 쿼리를 감지해 토스트를 띄우고 URL을 정리한다.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { firebaseFunctions } from '../lib/firebase';
import { useToast } from './useToast';

export interface SlackStatus {
    connected: boolean;
    teamName?: string | null;
    botUserId?: string | null;
    connectedAt?: string | null;
}

export interface SlackStaffReadiness {
    name: string;
    email: string;
    matched: boolean;
}

/** 콜백 복귀 쿼리(?slack=error&reason=...)의 사용자 안내 문구 */
const ERROR_MESSAGES: Record<string, string> = {
    cancelled: 'Slack 연결이 취소되었습니다.',
    invalid_state: '연결 요청이 유효하지 않습니다. 설정 화면에서 다시 시도해주세요.',
    used_or_expired: '연결 요청이 만료되었습니다. 다시 시도해주세요.',
    already_linked: '이 Slack 워크스페이스는 이미 다른 기관에 연결되어 있습니다.',
    exchange_failed: 'Slack 인증에 실패했습니다. 잠시 후 다시 시도해주세요.',
    server: '연결 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
};

export function useSlackIntegration() {
    const { showToast } = useToast();
    const [status, setStatus] = useState<SlackStatus | null>(null); // null = 로딩 중
    const [staff, setStaff] = useState<SlackStaffReadiness[] | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [diagnosing, setDiagnosing] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const queryHandled = useRef(false);

    const loadStatus = useCallback(async (): Promise<SlackStatus | null> => {
        try {
            const callable = httpsCallable<void, SlackStatus>(firebaseFunctions, 'getSlackConnectionStatus');
            const res = await callable();
            setStatus(res.data);
            return res.data;
        } catch (err) {
            console.warn('[useSlackIntegration] 상태 조회 실패:', err);
            setStatus({ connected: false });
            return null;
        }
    }, []);

    const diagnose = useCallback(async (options?: { silent?: boolean }) => {
        setDiagnosing(true);
        try {
            const callable = httpsCallable<void, { ok: boolean; staff: SlackStaffReadiness[] }>(
                firebaseFunctions, 'diagnoseSlackConnection'
            );
            const res = await callable();
            setStaff(res.data.staff);
            if (!options?.silent) {
                const unmatched = res.data.staff.filter((s) => !s.matched).length;
                showToast(
                    unmatched === 0
                        ? '연결 정상 — 모든 직원이 준비되었습니다.'
                        : `연결 정상 — 직원 ${unmatched}명의 Slack 이메일이 일치하지 않습니다.`,
                    unmatched === 0 ? 'success' : 'warning'
                );
            }
            return true;
        } catch (err) {
            setStaff(null);
            if (!options?.silent) {
                const msg = err instanceof Error ? err.message : String(err);
                showToast(msg.includes('연결된') ? msg : 'Slack 연결 테스트에 실패했습니다. 연결을 해제하고 다시 연결해주세요.', 'error');
            }
            return false;
        } finally {
            setDiagnosing(false);
        }
    }, [showToast]);

    /** "Slack에 연결하기" — 서명된 설치 URL을 받아 Slack 인증 화면으로 이동 */
    const connect = useCallback(async () => {
        setConnecting(true);
        try {
            const callable = httpsCallable<void, { url: string }>(firebaseFunctions, 'getSlackInstallUrl');
            const res = await callable();
            window.location.href = res.data.url;
            // 페이지 이탈 — setConnecting 해제 불필요 (실패 시에만 아래로)
        } catch (err) {
            console.warn('[useSlackIntegration] 설치 URL 발급 실패:', err);
            showToast('연결을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.', 'error');
            setConnecting(false);
        }
    }, [showToast]);

    const disconnect = useCallback(async () => {
        setDisconnecting(true);
        try {
            const callable = httpsCallable(firebaseFunctions, 'disconnectSlack');
            await callable();
            setStaff(null);
            setStatus({ connected: false });
            showToast('Slack 연결을 해제했습니다.', 'success');
        } catch (err) {
            console.warn('[useSlackIntegration] 연결 해제 실패:', err);
            showToast('연결 해제에 실패했습니다. 잠시 후 다시 시도해주세요.', 'error');
        } finally {
            setDisconnecting(false);
        }
    }, [showToast]);

    // 마운트: OAuth 콜백 복귀 쿼리 처리 + 상태 로드 (연결돼 있으면 진단 자동 1회)
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const slackParam = params.get('slack');
        if (slackParam && !queryHandled.current) {
            queryHandled.current = true;
            if (slackParam === 'connected') {
                showToast('Slack 워크스페이스가 연결되었습니다! 🎉', 'success');
            } else {
                const reason = params.get('reason') || 'server';
                showToast(ERROR_MESSAGES[reason] || ERROR_MESSAGES.server, 'error');
            }
            // 새로고침 시 토스트 재발생 방지 — 쿼리 제거
            params.delete('slack');
            params.delete('reason');
            const rest = params.toString();
            window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
        }

        void loadStatus().then((s) => {
            if (s?.connected) void diagnose({ silent: true });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return {
        status, staff,
        connecting, diagnosing, disconnecting,
        connect, disconnect, diagnose,
    };
}
