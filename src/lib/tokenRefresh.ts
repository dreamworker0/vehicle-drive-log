/**
 * tokenRefresh — Firebase Auth 토큰 갱신 유틸리티
 *
 * getIdToken(true) 호출 시 네트워크 오류(auth/network-request-failed)가
 * 발생할 수 있으므로, 지수 백오프 재시도 + 중복 호출 디바운스를 제공한다.
 */
import type { User } from 'firebase/auth';

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
                return; // 성공
            } catch (err) {
                if (!isNetworkError(err) || attempt === maxRetries - 1) {
                    // 네트워크 에러가 아니거나 마지막 시도 → 에러 전파
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
 * 초기 로드나 Claims 변경 감지 후 "최선 노력" 갱신에 사용.
 */
export async function refreshTokenSilently(user: User): Promise<void> {
    try {
        await refreshToken(user);
    } catch (err) {
        console.warn('[TokenRefresh] 토큰 갱신 실패 (무시):', err);
    }
}
