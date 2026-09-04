import { signInWithPopup, signInWithRedirect, signOut, getRedirectResult } from 'firebase/auth';
import type { AuthError } from 'firebase/auth';
import { auth, googleProvider, clearOfflineCache } from './firebase';
import { clearQueue, getPendingCount } from './offline/syncQueue';
import { useConfirmStore } from '../store/useConfirmStore';

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

/**
 * 로그아웃 전에 오프라인 큐의 미전송 기록을 확인한다. 있으면 사용자에게 묻고, 취소하면 false.
 *
 * 아래 logout()은 공용 기기 대비로 큐를 무조건 비운다. 그런데 지하 주차장에서 운행일지를 쓰고
 * 신호가 돌아오기 전에 [로그아웃]을 누르면 그 기록이 아무 안내 없이 사라졌다 — 유실을 알려 주는
 * 실패 표식(failed-store)까지 같은 호출에서 함께 지워지므로 나중에도 알 길이 없었다 (2026-09-02).
 * 건수 조회가 실패하면(IDB 불가 환경) 묻지 않고 진행한다 — 로그아웃 자체를 막지는 않는다.
 */
async function confirmDiscardPendingWrites(): Promise<boolean> {
    let pending = 0;
    try {
        pending = await getPendingCount();
    } catch {
        return true;
    }
    if (pending <= 0) return true;
    const answer = await useConfirmStore.getState().confirm({
        title: '전송되지 않은 기록이 있습니다',
        message: `아직 서버에 저장되지 않은 기록이 ${pending}건 있습니다.\n지금 로그아웃하면 이 기록은 삭제됩니다.\n인터넷이 연결된 뒤 잠시 기다리면 자동으로 저장됩니다.`,
        confirmText: '삭제하고 로그아웃',
        cancelText: '취소',
        confirmColor: 'danger',
    });
    return answer === true;
}

export const logout = async () => {
    // 미전송 기록이 있으면 먼저 묻는다. 취소하면 아무것도 하지 않는다.
    if (!(await confirmDiscardPendingWrites())) return;

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
    // 목적지 관련 로컬 캐시도 함께 지운다. 여기에는 확정된 목적지("○○○ 어르신 댁 …")뿐
    // 아니라 **치다가 지운 검색어와 그 후보 목록**까지 남는다. 공용 태블릿에서 다음 사람이
    // 앞사람이 어디를 찾아봤는지 알 수 있으면 안 된다 (2026-07-10 감사 #8과 같은 취지).
    for (const key of ['poi_search_cache_v1', 'tmap_geo_cache_v1', 'tmap_route_cache_v1']) {
        try { localStorage.removeItem(key); } catch { /* 저장소를 못 쓰면 넘어간다 */ }
    }
    // Firestore 영구 캐시 폐기 → 인스턴스가 종료되므로 깨끗한 상태로 재시작한다.
    await clearOfflineCache();
    if (typeof window !== 'undefined') {
        window.location.href = '/';
    }
};
