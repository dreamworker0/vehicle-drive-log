import { signInWithPopup, signInWithRedirect, signOut, getRedirectResult } from 'firebase/auth';
import type { AuthError } from 'firebase/auth';
import { auth, googleProvider, clearOfflineCache } from './firebase';
import { clearQueue, getPendingCount } from './offline/syncQueue';
import { useConfirmStore } from '../store/useConfirmStore';
import { markIntentionalLogout, wasIntentionalLogout, writeReturningHint } from './sessionBoot';

// 의도적 로그아웃 표식은 sessionBoot가 소유한다(경량 진입점도 읽어야 해서 Firebase 의존이 없어야 한다).
export { wasIntentionalLogout };

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

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
    // 재방문 힌트도 지금 내린다. 다음 부팅의 세션 소실 감지(sessionBoot)가 이 힌트를 근거로
    // 쓰는데, 표식의 유효창(10초)보다 로그아웃 정리가 길어지면 정상 로그아웃이 오탐으로 잡힌다.
    writeReturningHint(false);
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
    // ⚠️ 목적지 관련 로컬 캐시(tmap_geo_cache_v1 · tmap_route_cache_v1 · poi_search_cache_v1)는
    // 여기서 지우지 않는다. Tmap 무료 한도를 아끼는 것이 이 캐시들의 존재 이유인데,
    // 로그아웃마다 비우면 다음 사용자가 같은 곳을 다시 조회해 절감이 사라진다.
    // 대신 남는 것을 알고 있어야 한다 — 확정된 목적지("○○○ 어르신 댁 …")와 치다가 지운
    // 검색어·후보 목록이 이 기기에 계속 보관된다. 공용 태블릿에서 정리가 필요해지면
    // poi_search_cache_v1(검색어)만 먼저 떼는 것이 절감 손실이 가장 적다.
    // Firestore 영구 캐시 폐기 → 인스턴스가 종료되므로 깨끗한 상태로 재시작한다.
    await clearOfflineCache();
    if (typeof window !== 'undefined') {
        window.location.href = '/';
    }
};
