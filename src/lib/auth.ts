import { signInWithPopup, signInWithRedirect, signOut, getRedirectResult } from 'firebase/auth';
import type { AuthError } from 'firebase/auth';
import { auth, googleProvider, clearOfflineCache } from './firebase';
import { clearQueue } from './offline/syncQueue';

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

/**
 * 사용자가 스스로 로그아웃했음을 남기는 표시.
 *
 * **왜 필요한가.** 화면에서 보면 "의도한 로그아웃"과 "세션이 저 혼자 사라진 것"이 똑같다 —
 * 둘 다 `onAuthStateChanged(null)` 하나로 도착하고 로그인 화면으로 끝난다. 구분이 없으면
 * 후자를 보고할 수 없거나(원인 추적 불가) 전자까지 보고해서(노이즈) 둘 다 못 쓴다.
 *
 * **왜 localStorage인가.** 한 탭에서 로그아웃하면 Firebase Auth가 세션을 공유하는
 * 다른 탭도 함께 로그아웃된다. 그 탭에게도 "이건 의도된 것"이 보여야 하므로 모듈 변수로는
 * 부족하다. 스토리지가 막힌 환경(사파리 프라이빗 등)을 위해 모듈 변수를 함께 둔다 —
 * 그 경우 자기 탭에서만 구분되고, 다른 탭은 한 번 오탐 보고할 뿐 동작은 같다.
 */
const INTENTIONAL_LOGOUT_KEY = 'vdl:intentional-logout';
/** 표시가 유효한 창. 로그아웃 직후 도착하는 null 발화만 덮으면 되므로 짧게 잡는다. */
const INTENTIONAL_LOGOUT_WINDOW_MS = 10_000;

let intentionalLogoutAt = 0;

/** 의도적 로그아웃을 표시한다. signOut 직전에 부른다(발화가 먼저 오는 경우가 있다). */
export function markIntentionalLogout(): void {
    intentionalLogoutAt = Date.now();
    try {
        localStorage.setItem(INTENTIONAL_LOGOUT_KEY, String(intentionalLogoutAt));
    } catch {
        // 스토리지가 막힌 환경 — 모듈 변수만으로 자기 탭은 구분된다
    }
}

/** 방금 사용자가 스스로 로그아웃했는가. 세션 소멸을 보고할지 판단하는 데만 쓴다. */
export function wasIntentionalLogout(): boolean {
    const now = Date.now();
    if (intentionalLogoutAt && now - intentionalLogoutAt < INTENTIONAL_LOGOUT_WINDOW_MS) return true;
    try {
        const raw = localStorage.getItem(INTENTIONAL_LOGOUT_KEY);
        if (!raw) return false;
        const at = Number(raw);
        return Number.isFinite(at) && now - at < INTENTIONAL_LOGOUT_WINDOW_MS;
    } catch {
        return false;
    }
}

/**
 * Google 로그인.
 *
 * - 프로덕션: signInWithRedirect 사용 (안정적인 리다이렉트 플로우)
 * - 개발 환경(localhost): signInWithPopup 사용
 *   → signInWithRedirect는 authDomain(vehicle-drive-log.web.app)과 localhost 간
 *     cross-origin storage 문제로 인증 상태가 유실됨
 */
export const signInWithGoogle = async () => {
    try {
        if (isLocalhost) {
            console.info('[Auth] Google 로그인 - signInWithPopup 시도 (localhost)');
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
    // signOut보다 먼저 표시한다 — onAuthStateChanged(null)이 await보다 앞서 도착할 수 있고,
    // 그때 표시가 없으면 정상 로그아웃이 '예기치 않은 세션 종료'로 보고된다.
    markIntentionalLogout();
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
