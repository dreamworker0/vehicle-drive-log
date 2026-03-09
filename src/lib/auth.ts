import { signInWithPopup, signInWithRedirect, signOut, getRedirectResult } from 'firebase/auth';
import type { AuthError } from 'firebase/auth';
import { auth, googleProvider } from './firebase';

/**
 * PWA standalone 모드 또는 팝업 불가 환경 감지.
 * Android Chrome은 popup이 새 탭으로 정상 작동하므로 redirect 대상에서 제외.
 * iOS Safari는 ITP로 인해 signInWithRedirect 후 세션이 유지되지 않으므로
 * signInWithPopup을 우선 사용하고, 팝업 차단 시에만 redirect로 전환.
 */
function shouldUseRedirect() {
    // PWA standalone 모드 — popup 창을 열 수 없음
    if (window.matchMedia?.('(display-mode: standalone)')?.matches) return true;
    // iOS standalone (홈 화면에서 실행)
    if ((navigator as Navigator & { standalone?: boolean }).standalone) return true;
    // TWA (Trusted Web Activity)
    if (document.referrer?.includes('android-app://')) return true;
    // iOS Safari — ITP로 인해 signInWithRedirect 세션 유지가 불안정
    // signInWithPopup을 우선 사용 (팝업 차단 시 catch에서 redirect로 자동 전환)
    // Android Chrome도 popup(새 탭) 방식이 안정적
    return false;
}

export const signInWithGoogle = async () => {
    try {
        if (shouldUseRedirect()) {
            // PWA standalone / 인앱 브라우저: redirect 사용
            await signInWithRedirect(auth, googleProvider);
            return; // 페이지 재로드됨
        }
        // 일반 브라우저: popup 사용
        const result = await signInWithPopup(auth, googleProvider);
        return result.user;
    } catch (error) {
        const authErr = error as AuthError;
        // 팝업 차단 시 redirect로 자동 전환
        if (authErr.code === 'auth/popup-blocked' ||
            authErr.code === 'auth/popup-closed-by-user') {
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
