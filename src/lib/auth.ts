import { signInWithRedirect, signInWithPopup, signOut, getRedirectResult } from 'firebase/auth';
import type { AuthError } from 'firebase/auth';
import { auth, googleProvider } from './firebase';

/**
 * Google 로그인.
 *
 * - 프로덕션: signInWithRedirect 사용 (COOP 에러 없는 안정적인 리다이렉트 플로우)
 * - 개발 환경(localhost): signInWithPopup 사용
 *   → signInWithRedirect는 authDomain(vehicle-drive-log.web.app)과 localhost 간
 *     cross-origin storage 문제로 인증 상태가 유실됨
 */
export const signInWithGoogle = async () => {
    try {
        if (import.meta.env.DEV) {
            console.info('[Auth] Google 로그인 - signInWithPopup 시도 (개발 환경)');
            await signInWithPopup(auth, googleProvider);
        } else {
            console.info('[Auth] Google 로그인 - signInWithRedirect 시도');
            await signInWithRedirect(auth, googleProvider);
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
        const result = await getRedirectResult(auth);
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
};
