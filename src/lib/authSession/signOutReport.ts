/**
 * 앱이 지시하지 않은 세션 종료의 원인 판별·보고.
 *
 * useAuth의 onAuthStateChanged 흐름에서 떼어 냈다. 판별은 증거(직전 토큰 갱신 실패,
 * 마지막으로 본 사용자 문서, 마지막 권한 거부)만으로 이루어지므로 React 상태와 무관하다.
 */
import { auth } from '../firebase';
import { getLastTokenRefreshFailure } from '../tokenRefresh';
import { wasIntentionalLogout } from '../auth';
import { captureError, captureWarning } from '../sentry';
import { useToastStore } from '../../store/useToastStore';

/**
 * 앱이 지시하지 않은 세션 종료의 원인 분류.
 * - token-invalidated: 우리 갱신 호출이 세션 무효화 코드로 실패했다(SDK가 signOut)
 * - account-disabled : 마지막으로 본 사용자 문서가 비활성 상태였다(관리자 조치 → 토큰 폐기)
 * - account-removed  : 사용자 문서가 확정적으로 없었다(기관 삭제·탈퇴·영구 삭제)
 * - unknown          : 위 증거가 하나도 없다 — 저장소 소멸·SDK 오동작 후보. 이것만 error로 올린다
 */
export type SignOutCause = 'token-invalidated' | 'account-disabled' | 'account-removed' | 'unknown';

/** 원인별 안내 문구 — 사용자가 할 수 있는 조치가 다르다(문의 vs 재로그인). */
export const SIGN_OUT_MESSAGES: Record<SignOutCause, string> = {
    'token-invalidated': '보안을 위해 세션이 종료되었습니다. 다시 로그인해 주세요.',
    'account-disabled': '계정이 비활성화되어 로그아웃되었습니다. 기관 관리자에게 문의해 주세요.',
    'account-removed': '소속 정보가 변경되어 로그아웃되었습니다. 다시 로그인해 주세요.',
    unknown: '세션이 만료되어 로그아웃되었습니다. 다시 로그인해 주세요.',
};

/** 마지막으로 본 사용자 문서의 상태 — 세션이 사라졌을 때 서버가 끊은 것인지 가리는 근거 */
export type LastUserDoc = { exists: boolean; status?: string } | null;

/** 마지막으로 규칙에 막힌 구독 — 세션 소멸과 권한 오류 중 무엇이 먼저였는지 판별에 쓴다 */
export type LastDenied = { scope: 'user' | 'org'; at: number } | null;

export interface SignOutEvidence {
    lastUserDoc: LastUserDoc;
    lastDenied: LastDenied;
    /** 세션이 확립된 시각. "얼마나 버텼는지"가 원인을 좁힌다. */
    sessionStartedAt: number | null;
}

/**
 * 세션이 왜 사라졌는지를 가진 증거로 가른다.
 *
 * 2026-09-02 첫 실제 보고(Samsung Internet·Android 10, /employee/today)에서 드러난 것:
 * 원인이 무엇이든 전부 같은 error 이슈로 올라가 고우선 알림 메일이 왔다. 그런데 이 중
 * 서버가 의도한 결과(계정 비활성화·토큰 폐기)는 운영자가 할 일이 없는 사건이다.
 * 갈라 두지 않으면 진짜 결함(저장소 소멸·SDK 오동작)이 그 사이에 묻힌다.
 */
export function classifySignOut(lastUserDoc: LastUserDoc): { cause: SignOutCause; detail?: string } {
    const failure = getLastTokenRefreshFailure();
    // fatal이면 이 실패가 로그아웃의 직접 원인이다(SDK가 스스로 signOut 한다).
    if (failure?.fatal) return { cause: 'token-invalidated', detail: failure.code };
    if (lastUserDoc?.exists && lastUserDoc.status === 'disabled') return { cause: 'account-disabled' };
    // 문서가 확정적으로 없었다 — 기관 삭제·탈퇴·영구 삭제로 계정 자체가 정리된 경로
    if (lastUserDoc && !lastUserDoc.exists) return { cause: 'account-removed' };
    return { cause: 'unknown' };
}

/**
 * 앱이 지시하지 않은 세션 소멸을 보고하고 사용자에게 알린다.
 *
 * **왜 필요한가.** 지금까지 이 구간에 남는 것은 `console.debug` 한 줄뿐이었고
 * DevTools 기본 수준에서는 그마저 숨겨진다. 그래서 "갑자기 로그아웃됐다"는 제보가
 * 와도 (a) 토큰이 무효화돼 SDK가 로그아웃시킨 것인지 (b) 브라우저에 저장된 세션이
 * 밖에서 지워진 것인지 가릴 근거가 없었다. 남는 것은 Firestore의
 * `permission-denied` 뿐인데 **그건 세션이 사라진 결과**라 원인을 지목하지 못한다.
 *
 * 그래서 그 판별에 필요한 것만 함께 실어 보낸다 — 직전 토큰 갱신 실패(fatal 여부),
 * 세션 지속 시간, 마지막으로 규칙에 막힌 구독, 탭 가시성·온라인 여부.
 * 의도적 로그아웃은 보고하지 않는다(정상 경로이고, 매 로그아웃마다 이슈가 쌓인다).
 */
export function reportUnexpectedSignOut(uid: string, evidence: SignOutEvidence): void {
    if (wasIntentionalLogout()) return;

    const now = Date.now();
    const failure = getLastTokenRefreshFailure();
    const denied = evidence.lastDenied;
    const { cause, detail } = classifySignOut(evidence.lastUserDoc);
    const context = {
        uid,
        cause,
        detail: detail ?? null,
        sessionAgeMs: evidence.sessionStartedAt ? now - evidence.sessionStartedAt : null,
        tokenRefreshFailure: failure
            ? { code: failure.code, fatal: failure.fatal, agoMs: now - failure.at }
            : null,
        lastPermissionDenied: denied
            ? { scope: denied.scope, agoMs: now - denied.at }
            : null,
        lastUserDoc: evidence.lastUserDoc,
        visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
        online: typeof navigator !== 'undefined' ? navigator.onLine : null,
        hasCurrentUser: !!auth.currentUser,
        // 세션 저장소가 IndexedDB인지 가늠하는 최소 단서 — 없으면 SDK는 localStorage로 내려간다
        indexedDBAvailable: typeof indexedDB !== 'undefined',
    };

    if (cause !== 'unknown') {
        // 서버가 끊은 세션 — 사실은 남기되(빈도가 근거다) 알림은 울리지 않는다.
        captureWarning(`[Auth] 세션 종료 — ${cause}`, context);
        useToastStore.getState().showToast(SIGN_OUT_MESSAGES[cause], 'warning', 6000);
        return;
    }

    // captureError는 Error만 콘솔에 찍는다 — 제보자가 콘솔을 보내 주는 경우가 많으므로
    // 판별 근거도 콘솔에 남긴다(error 수준이라 DevTools 기본 수준에서 보인다).
    console.error('[Auth] 예기치 않은 세션 종료 — 판별 근거:', context);
    captureError(new Error('[Auth] 예기치 않은 세션 종료'), context);

    // 지금까지는 아무 설명 없이 로그인 화면만 떴다. 무엇이 일어났는지는 알려 준다.
    useToastStore.getState().showToast(SIGN_OUT_MESSAGES.unknown, 'warning', 6000);
}

/**
 * 로그아웃 확정 뒤 이 시간 안에 같은 세션이 돌아오면 "저장소 일시 장애"로 기록한다.
 * SDK의 저장소 폴링 주기(수백 ms)와 느린 기기의 IndexedDB 회복 시간을 넉넉히 덮는 값이다.
 */
const SESSION_RESTORE_WINDOW_MS = 30_000;

/**
 * 로그아웃으로 확정한 세션이 곧바로 돌아왔는지 기록한다 — 진짜 소멸이 아니라 저장소 일시 장애다.
 * 앞서 나간 '예기치 않은 종료' 보고와 짝을 맞춰 남긴다(같은 uid·간격). 이 기록이
 * 쌓이면 유예를 늘리는 근거가 되고, 없으면 그 가설을 접을 근거가 된다.
 */
export function reportSessionRestoredAfterDrop(dropped: { uid: string; at: number }, uid: string): void {
    const gapMs = Date.now() - dropped.at;
    if (dropped.uid !== uid || gapMs >= SESSION_RESTORE_WINDOW_MS) return;
    captureWarning('[Auth] 로그아웃 확정 후 같은 세션이 복귀', {
        uid,
        gapMs,
        visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
        online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    });
}
