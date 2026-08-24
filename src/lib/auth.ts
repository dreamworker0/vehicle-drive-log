import { signInWithPopup, signInWithRedirect, signOut, getRedirectResult, browserPopupRedirectResolver } from 'firebase/auth';
import type { AuthError } from 'firebase/auth';
import { auth, googleProvider, clearOfflineCache } from './firebase';
import { clearQueue } from './offline/syncQueue';

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

/**
 * Google 로그인.
 *
 * - 프로덕션: signInWithRedirect 사용 (안정적인 리다이렉트 플로우)
 * - 개발 환경(localhost): signInWithPopup 사용
 *   → signInWithRedirect는 authDomain(vehicle-drive-log.web.app)과 localhost 간
 *     cross-origin storage 문제로 인증 상태가 유실됨
 *
 * `browserPopupRedirectResolver`를 **인자로 직접 넘긴다.** auth 인스턴스는 리졸버 없이
 * 초기화되어 있다(랜딩에서 gapi를 받지 않기 위해 — firebaseAuth.ts 주석 참고). 넘기지
 * 않으면 auth/argument-error가 난다.
 */
export const signInWithGoogle = async () => {
    try {
        if (isLocalhost) {
            console.info('[Auth] Google 로그인 - signInWithPopup 시도 (localhost)');
            await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
        } else {
            console.info('[Auth] Google 로그인 - signInWithRedirect 시도');
            await signInWithRedirect(auth, googleProvider, browserPopupRedirectResolver);
        }
    } catch (error) {
        const authErr = error as AuthError;
        console.error('Google 로그인 실패:', authErr.code, authErr.message, error);
        throw error;
    }
};

/**
 * Redirect 로그인 복귀 시 결과 처리.
 * onAuthStateChanged가 자동으로 user를 감지하므로,
 * 이 함수는 에러 처리 목적으로만 호출한다.
 */
export const handleRedirectResult = async () => {
    try {
        const result = await getRedirectResult(auth, browserPopupRedirectResolver);
        return result?.user ?? null;
    } catch (error) {
        // redirect 인증을 사용하지 않은 환경에서 getRedirectResult 호출 시
        // Firebase 내부에서 발생하는 정상적인 assertion — 무시해도 안전
        const errMsg = (error as Error)?.message;
        if (errMsg?.includes('Pending promise was never set')) {
            return null;
        }
        const authErr = error as AuthError;
        console.error('Redirect 로그인 결과 처리 실패:', authErr.code, authErr.message);
        throw error;
    }
};

export const logout = async () => {
    try {
        await signOut(auth);
    } catch (error) {
        console.error('로그아웃 실패:', error);
        throw error;
    }

    // 공용 기기 대비 로컬 잔존 데이터 폐기 (2026-07-10 감사 #8).
    // 오프라인 큐는 사용자 식별자 없이 저장되어 다음 세션에 재생될 수 있으므로 반드시 제거한다.
    try {
        await clearQueue();
    } catch (e) {
        console.warn('[logout] 오프라인 큐 정리 실패:', e);
    }
    // Firestore 영구 캐시 폐기 → 인스턴스가 종료되므로 깨끗한 상태로 재시작한다.
    await clearOfflineCache();
    if (typeof window !== 'undefined') {
        window.location.href = '/';
    }
};
