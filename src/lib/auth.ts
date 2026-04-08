import { signInWithRedirect, signOut, getRedirectResult } from 'firebase/auth';
import type { AuthError } from 'firebase/auth';
import { auth, googleProvider } from './firebase';

/**
 * Google 로그인.
 * 팝업(signInWithPopup)의 고질적인 COOP 에러, Chrome 창 닫힘 추적 실패 이슈를 차단하기 위해
 * 환경 구분 없이 무조건 다이렉트(signInWithRedirect) 로그인만 사용합니다.
 */
export const signInWithGoogle = async () => {
    try {
        console.info('[Auth] Google 로그인 - signInWithRedirect 시도');
        await signInWithRedirect(auth, googleProvider);
    } catch (error) {
        const authErr = error as AuthError;
        console.error('Google 다이렉트 로그인 통신 실패:', authErr.code, authErr.message, error);
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
