/**
 * tokenRefresh — Firebase Auth 토큰 갱신 유틸리티
 *
 * getIdToken(true) 호출 시 네트워크 오류(auth/network-request-failed)가
 * 발생할 수 있으므로, 지수 백오프 재시도 + 중복 호출 디바운스를 제공한다.
 */
import type { User } from 'firebase/auth';

/**
 * **세션 자체가 무효화되는** 갱신 실패 코드.
 *
 * 이 코드들이 오면 Firebase SDK는 갱신을 포기하는 데 그치지 않고 **스스로 signOut 한다**
 * (`_logoutIfInvalidated`). 즉 앱이 로그아웃을 지시한 적이 없는데도 세션이 사라지고,
 * 살아 있던 Firestore 리스너는 그 직후 `permission-denied`를 받는다 — 화면에는
 * "갑자기 로그아웃됐다"로만 보인다.
 *
 * 리프레시 토큰이 무효가 되는 경로는 계정 자격 변경(비밀번호 등)·Auth 계정 비활성/삭제·
 * `revokeRefreshTokens`(disableUser)다. 네트워크 실패와 처방이 정반대이므로
 * (재시도해도 소용없다) 반드시 갈라서 본다.
 */
const SESSION_INVALIDATING_CODES = new Set([
    'auth/user-token-expired',
    'auth/user-disabled',
    'auth/user-not-found',
    'auth/invalid-user-token',
]);

export interface TokenRefreshFailure {
    /** Firebase Auth 에러 코드 (없으면 메시지 앞부분) */
    code: string;
    /** 세션이 무효화되는 코드인가 — true면 이 실패가 곧 로그아웃의 원인이다 */
    fatal: boolean;
    /** 발생 시각 (epoch ms) */
    at: number;
}

/** 마지막 갱신 실패. 세션이 사라졌을 때 원인을 지목하는 근거로 쓴다. */
let _lastFailure: TokenRefreshFailure | null = null;

/**
 * 마지막 토큰 갱신 실패를 돌려준다(없으면 null).
 *
 * 예기치 않은 세션 종료를 보고할 때 함께 실어 보낸다 — 직전에 fatal 실패가 있었다면
 * "토큰이 무효화돼 SDK가 로그아웃시킨 것"이고, 없다면 "브라우저에 저장된 세션이
 * 밖에서 지워진 것"으로 갈린다. 이 구분이 없으면 둘 다 똑같은 로그인 화면으로만 보인다.
 */
export function getLastTokenRefreshFailure(): TokenRefreshFailure | null {
    return _lastFailure;
}

/** 테스트 전용 — 모듈 간 상태 누수를 막는다. */
export function resetLastTokenRefreshFailure(): void {
    _lastFailure = null;
}

function recordFailure(err: unknown): void {
    const code = (err as { code?: string })?.code
        || (err as { message?: string })?.message?.slice(0, 80)
        || 'unknown';
    const fatal = SESSION_INVALIDATING_CODES.has(code);
    _lastFailure = { code, fatal, at: Date.now() };
    if (fatal) {
        // 로그아웃의 직접 원인이므로 warn이 아니라 error로 남긴다 — DevTools 기본 수준에서도 보인다.
        console.error(`[TokenRefresh] 세션이 무효화된 갱신 실패 (${code}) — SDK가 로그아웃시킵니다`, err);
    }
}

/** 네트워크 관련 Firebase Auth 에러인지 판별 */
function isNetworkError(err: unknown): boolean {
    const code = (err as { code?: string })?.code;
    const message = (err as { message?: string })?.message || '';
    return (
        code === 'auth/network-request-failed' ||
        message.includes('auth/network-request-failed') ||
        message.includes('network error') ||
        message.includes('Failed to fetch')
    );
}

/** 지연 유틸리티 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 진행 중인 갱신 Promise (중복 호출 방지) */
let _pendingRefresh: Promise<void> | null = null;

/**
 * 토큰 강제 갱신 (지수 백오프 재시도 포함)
 *
 * - 네트워크 에러 시 최대 maxRetries 회 재시도 (1s → 2s → 4s, 최대 5s)
 * - 이미 진행 중인 갱신이 있으면 해당 Promise를 재사용 (중복 호출 방지)
 * - 네트워크 에러가 아닌 경우(auth/user-disabled 등) 즉시 에러 전파
 */
export async function refreshToken(user: User, maxRetries = 3): Promise<void> {
    // 이미 진행 중인 갱신이 있으면 그 Promise를 재사용
    if (_pendingRefresh) return _pendingRefresh;

    _pendingRefresh = (async () => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                await user.getIdToken(true);
                _lastFailure = null; // 갱신에 성공했으므로 이전 실패 기록은 더 이상 원인이 아니다
                return; // 성공
            } catch (err) {
                if (!isNetworkError(err) || attempt === maxRetries - 1) {
                    // 네트워크 에러가 아니거나 마지막 시도 → 에러 전파
                    recordFailure(err);
                    throw err;
                }
                // 지수 백오프 대기 (1s → 2s → 4s, 최대 5s)
                const waitMs = Math.min(1000 * 2 ** attempt, 5000);
                console.debug(
                    `[TokenRefresh] 네트워크 오류 — ${waitMs}ms 후 재시도 (${attempt + 1}/${maxRetries})`
                );
                await delay(waitMs);
            }
        }
    })();

    try {
        await _pendingRefresh;
    } finally {
        _pendingRefresh = null;
    }
}

/**
 * 토큰 갱신 (실패 무시 — fire-and-forget 용도)
 *
 * 갱신 실패 시 console.warn만 남기고 에러를 삼킴.
 * onError 콜백을 넘기면 실패를 UI로 전달할 수 있다 (예: 권한 변경 후 반영 실패 토스트).
 */
export async function refreshTokenSilently(
    user: User,
    onError?: (err: unknown) => void
): Promise<void> {
    try {
        await refreshToken(user);
    } catch (err) {
        console.warn('[TokenRefresh] 토큰 갱신 실패 (무시):', err);
        if (onError) {
            try { onError(err); } catch { /* 콜백 오류는 무시 */ }
        }
    }
}
