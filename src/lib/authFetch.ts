/**
 * authFetch — 인증된 HTTP 요청 유틸리티
 *
 * Cloud Function 프록시(tmapProxy, holidayProxy 등)가 Firebase Auth 토큰을
 * 요구하므로, 프로덕션 fetch 호출 시 Authorization 헤더를 자동 포함한다.
 */
import { auth } from './firebase';

/**
 * 현재 로그인된 사용자의 ID 토큰으로 Authorization 헤더를 생성한다.
 * 로그인 상태가 아니거나 토큰 발급에 실패하면 빈 객체를 반환한다.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
    try {
        const token = await auth.currentUser?.getIdToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
        return {};
    }
}
