import { signInWithPopup, signInWithRedirect, signOut, getRedirectResult } from 'firebase/auth';
import type { AuthError } from 'firebase/auth';
import { auth, googleProvider } from './firebase';

/**
 * Google 로그인.
 * PWA standalone 모드에서도 signInWithPopup을 우선 사용한다.
 * signInWithRedirect는 PWA에서 서비스 워커 간섭, 리다이렉트 결과 손실 등으로
 * 매우 불안정하므로 popup 실패(팝업 차단) 시에만 폴백으로 사용한다.
 */
export const signInWithGoogle = async () => {
    // 1. 브라우저 환경 및 기기 감지 (PWA 단독 모드 확인)
    const isStandalone = typeof window !== 'undefined' && (
        window.matchMedia('(display-mode: standalone)').matches ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ('standalone' in navigator && (navigator as any).standalone === true)
    );
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
    
    // 주요 모바일 인앱 브라우저 키워드 감지 (카카오톡, 라인, 네이버, 인스타그램, 페이스북 등)
    const isInAppBrowser = /kakaotalk|line|naver|instagram|fb_iab|fbav/.test(userAgent);
    
    // 2. 인앱 브라우저에서는 보통 팝업이 강제 차단되거나 오작동하므로 선제적으로 리다이렉트를 시도
    // (PWA standalone 모드에서는 리다이렉트 세션 유실 방지를 위해 기존 팝업 사용 우선 유지)
    if (isInAppBrowser && !isStandalone) {
        console.info('[Auth] 모바일 인앱 브라우저 환경 감지 — signInWithRedirect 로직 전환');
        await signInWithRedirect(auth, googleProvider);
        return; 
    }

    try {
        const result = await signInWithPopup(auth, googleProvider);
        return result.user;
    } catch (error) {
        const authErr = error as AuthError;
        // 팝업 차단 명시적 에러 시 redirect로 자동 전환 폴백
        if (authErr.code === 'auth/popup-blocked' ||
            authErr.code === 'auth/popup-closed-by-user') {
            console.warn('[Auth] 팝업 차단 감지, 리다이렉트 폴백 시도:', authErr.code);
            await signInWithRedirect(auth, googleProvider);
            return;
        }
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
