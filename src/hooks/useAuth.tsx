/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, useRef, createContext, useContext, ReactNode } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { auth, db, authReady, getAppCheckBlock } from '../lib/firebase';
import { isFirestoreTerminated } from '../lib/firestoreLifecycle';
import { refreshTokenSilently, refreshToken, getLastTokenRefreshFailure } from '../lib/tokenRefresh';
import { handleRedirectResult, wasIntentionalLogout } from '../lib/auth';
import { setSentryUser, captureError, captureWarning } from '../lib/sentry';
import { useToastStore } from '../store/useToastStore';
import type { User as UserDoc } from '../types/user';
import { resolveOrgFeatures, ALL_FEATURES_ON, type OrgFeatures } from '../lib/orgFeatures';
import { resolveOrgSites, type OrgSite } from '../lib/orgSites';

/**
 * 사용자 Firestore 문서의 로딩 확정 상태.
 * - 'pending': 아직 로딩 중이거나 일시적 오류로 미확정 (라우팅 판단 보류 대상)
 * - 'present': 문서가 존재함 (userData 세팅됨)
 * - 'absent' : 문서가 확정적으로 없음 (신규가입 → 온보딩 필요)
 *
 * `userData === null`만으로는 '아직 로딩 중'과 '실제로 없음'을 구분할 수 없어
 * 재방문 시 토큰 갱신/네트워크 지연 도중 잘못 온보딩 화면으로 라우팅되는 버그가 있었다.
 */
type UserDocState = 'pending' | 'present' | 'absent';

interface AuthContextType {
    user: FirebaseUser | null;
    userData: UserDoc | null;
    userDocState: UserDocState;
    loading: boolean;
    isSuperAdmin: boolean;
    orgDeleted: boolean;
    /** 기관별 기능 사용 토글(실시간). 기본값 전부 켜짐. */
    orgFeatures: OrgFeatures;
    /** 기관의 출발지(본관 + 분관, 실시간). 분관을 등록하지 않은 기관은 본관 한 개뿐. */
    orgSites: OrgSite[];
    /** @deprecated onSnapshot이 자동 처리. 호환성을 위해 유지. */
    refreshUserData: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * 앱이 지시하지 않은 세션 종료의 원인 분류.
 * - token-invalidated: 우리 갱신 호출이 세션 무효화 코드로 실패했다(SDK가 signOut)
 * - account-disabled : 마지막으로 본 사용자 문서가 비활성 상태였다(관리자 조치 → 토큰 폐기)
 * - account-removed  : 사용자 문서가 확정적으로 없었다(기관 삭제·탈퇴·영구 삭제)
 * - unknown          : 위 증거가 하나도 없다 — 저장소 소멸·SDK 오동작 후보. 이것만 error로 올린다
 */
type SignOutCause = 'token-invalidated' | 'account-disabled' | 'account-removed' | 'unknown';

/** 원인별 안내 문구 — 사용자가 할 수 있는 조치가 다르다(문의 vs 재로그인). */
const SIGN_OUT_MESSAGES: Record<SignOutCause, string> = {
    'token-invalidated': '보안을 위해 세션이 종료되었습니다. 다시 로그인해 주세요.',
    'account-disabled': '계정이 비활성화되어 로그아웃되었습니다. 기관 관리자에게 문의해 주세요.',
    'account-removed': '소속 정보가 변경되어 로그아웃되었습니다. 다시 로그인해 주세요.',
    unknown: '세션이 만료되어 로그아웃되었습니다. 다시 로그인해 주세요.',
};

/**
 * 로그아웃 확정 뒤 이 시간 안에 같은 세션이 돌아오면 "저장소 일시 장애"로 기록한다.
 * SDK의 저장소 폴링 주기(수백 ms)와 느린 기기의 IndexedDB 회복 시간을 넉넉히 덮는 값이다.
 */
const SESSION_RESTORE_WINDOW_MS = 30_000;

/** App Check 차단으로 인한 접근 실패는 세션당 1회만 보고한다 — 원인이 하나라 반복 보고는 노이즈다. */
let appCheckDenialReported = false;

/**
 * `permission-denied`를 알릴 때 App Check 차단 여부로 문구를 가른다.
 *
 * 두 경우는 **사용자가 할 수 있는 조치가 완전히 다르다.** 권한 문제는 관리자 문의가 답이고,
 * App Check 차단은 SDK가 최대 24시간 스로틀에 들어간 상태라 **새로고침으로 풀리지 않는다.**
 * 그런데 기존 문구는 "페이지 새로고침 요망"이라, 차단된 사용자는 하루 종일 새로고침만
 * 반복하다 포기하게 된다(2026-09-01 Firefox 모바일 사례).
 */
function notifyAccessDenied(scope: 'org' | 'user', fallbackMessage: string, level: 'warning' | 'error') {
    const block = getAppCheckBlock();
    if (!block) {
        useToastStore.getState().showToast(fallbackMessage, level);
        return;
    }

    useToastStore.getState().showToast(
        '보안 인증(App Check)이 차단되어 데이터를 불러올 수 없습니다. 새로고침으로는 해결되지 않으니 잠시 후 다시 시도하거나 다른 브라우저를 이용해 주세요.',
        'error',
        8000,
    );

    if (appCheckDenialReported) return;
    appCheckDenialReported = true;
    // App Check 경고 자체는 노이즈라서 sentry.ts·firebase.ts에서 걸러진다. 그래서 **실제로
    // 피해가 난 순간**만 남긴다 — 이게 없으면 몇 명이 겪는지 알 수 없다(지금까지는 downstream
    // 401 한 건으로 추정해 왔다).
    captureError(new Error('[AppCheck] 보안 인증 차단으로 데이터 접근 실패'), {
        appCheckCode: block.code,
        blockedForMs: Date.now() - block.at,
        scope,
    });
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [userData, setUserData] = useState<UserDoc | null>(null);
    const [userDocState, setUserDocState] = useState<UserDocState>('pending');
    const [orgDeleted, setOrgDeleted] = useState(false);
    const [orgFeatures, setOrgFeatures] = useState<OrgFeatures>(ALL_FEATURES_ON);
    const [orgSites, setOrgSites] = useState<OrgSite[]>(() => resolveOrgSites(null));
    const [loading, setLoading] = useState(true);

    // Custom Claims 토큰 갱신을 위한 이전 role/orgId 추적
    const prevClaimsRef = useRef<{ role?: string; orgId?: string }>({});

    /**
     * 인증이 한 번 확립된 뒤의 uid. **null 발화를 즉시 믿을지 판단하는 근거**다.
     * 아직 로그인한 적이 없으면(최초 진입) null 발화는 진짜 비로그인이므로 유예 없이 처리한다.
     */
    const authedUidRef = useRef<string | null>(null);

    /** 세션이 확립된 시각. 예기치 않은 종료를 보고할 때 "얼마나 버텼는지"가 원인을 좁힌다. */
    const sessionStartedAtRef = useRef<number | null>(null);
    /** 마지막으로 규칙에 막힌 구독. 세션 소멸과 권한 오류 중 무엇이 먼저였는지 판별에 쓴다. */
    const lastDeniedRef = useRef<{ scope: 'user' | 'org'; at: number } | null>(null);
    /**
     * 마지막으로 본 사용자 문서의 상태. 세션이 사라졌을 때 **서버가 끊은 것인지**를 가리는 근거다.
     *
     * 관리자가 계정을 비활성화하면(`disableUser`) Auth 계정 disabled + 리프레시 토큰 폐기가 함께
     * 일어나고, SDK는 다음 갱신에서 스스로 signOut 한다. 그 갱신은 SDK 내부에서 돌아
     * `tokenRefresh.ts`의 실패 기록에 남지 않는다 — 우리 `refreshToken()`이 부른 갱신만 기록되기
     * 때문이다. 그래서 문서의 `status: 'disabled'`가 그 경로를 가리키는 유일한 증거가 된다.
     */
    const lastUserDocRef = useRef<{ exists: boolean; status?: string } | null>(null);
    /**
     * 로그아웃으로 **확정한 직후**의 uid·시각. 곧바로 같은 세션이 다시 발화하면 세션이 진짜로
     * 끊긴 것이 아니라 저장소(IndexedDB) 읽기가 잠깐 실패한 것이다 — SDK는 탭 간 동기화를 위해
     * 저장소를 주기적으로 읽는데, 그 읽기가 빈손으로 돌아오면 "다른 탭이 로그아웃했다"로 해석해
     * null을 흘리고, 다음 읽기가 성공하면 사용자를 되살린다. 그 왕복이 유예(2초)보다 길면
     * 이 훅은 진짜 로그아웃으로 확정해 버린다. 복귀를 잡아 기록하지 않으면 이 경우와
     * 진짜 세션 소멸이 Sentry에서 같은 이슈로 섞인다.
     */
    const recentDropRef = useRef<{ uid: string; at: number } | null>(null);

    useEffect(() => {
        let cancelled = false;

        // 10초 안에 로딩이 끝나지 않으면 강제 해제
        const timeout = setTimeout(() => {
            if (loading) {
                console.debug('로딩 타임아웃 - Firestore 연결이 느려 로딩을 강제 해제합니다');
                setLoading(false);
            }
        }, 10000);

        let unsubscribeAuth: (() => void) | null = null;
        let unsubscribeUser: Unsubscribe | null = null;
        let unsubscribeOrg: Unsubscribe | null = null;

        let pauseWatches: (() => void) | null = null;
        let resumeWatches: (() => void) | null = null;

        /**
         * 인증 확립 후 들어온 null을 확정하기까지의 유예.
         *
         * 탭을 두 개 띄워두면 한쪽에서 페이지를 옮길 때 다른 탭의 onAuthStateChanged가
         * 순간적으로 null을 흘리는 일이 있었다(Auth가 탭 간 세션을 재확인하는 구간).
         * 그걸 즉시 믿으면 AuthGuard가 `/login`으로, path="*"의 RouteFallback이 `/`(랜딩)으로
         * 보내 **로그인 화면이 번쩍 뜬다.** 유예 안에 세션이 돌아오면 화면을 건드리지 않는다.
         *
         * 로그아웃이 늦어지지는 않는다 — logout()은 끝에서 `window.location.href = '/'`로
         * 페이지를 떠나므로(lib/auth.ts) 이 타이머와 무관하다. 오히려 로그아웃이
         * clearOfflineCache()를 기다리는 동안 뜨던 플래시도 함께 사라진다.
         * 세션이 진짜로 끊긴 경우(만료·강제 무효화)는 유예가 지나면 그대로 확정된다.
         */
        const AUTH_DROP_GRACE_MS = 2000;
        let dropTimer: ReturnType<typeof setTimeout> | null = null;

        /**
         * Firestore 구독을 새로 걸어도 되는 상태인지.
         *
         * **왜 필요한가.** 로그아웃은 clearOfflineCache()로 Firestore를 terminate하고 페이지를
         * 떠나는데(lib/auth.ts), 떠나기 전까지 페이지는 살아 있다. 종료된 인스턴스에
         * onSnapshot을 걸면 SDK가 그 자리에서 동기 throw를 낸다
         * ("The client has already been terminated."). 아래 재시도 타이머에서 나면 잡아줄 곳이
         * 없어 uncaught로 Sentry까지 올라갔다(JAVASCRIPT-REACT-60, /admin/dashboard).
         */
        const canWatch = () => !cancelled && !isFirestoreTerminated();

        /**
         * permission-denied 재시도 타이머.
         *
         * 깨어난 시점에 **아직 같은 세션인지** 다시 본다. 로그아웃도 permission-denied를 낳으므로
         * (세션이 끊긴 리스너가 규칙에 막힌다) 그때의 재시도는 어차피 또 거부되고, 종료 직후라면
         * 위의 동기 throw로 이어진다. 세션이 유예 안에 돌아온 경우에는 onAuthStateChanged가
         * 다시 발화해 구독을 새로 걸어주므로 여기서 포기해도 복구를 잃지 않는다.
         */
        const scheduleWatchRetry = (uid: string, waitMs: number, restart: () => void) => {
            setTimeout(() => {
                if (!canWatch() || auth.currentUser?.uid !== uid) return;
                restart();
            }, waitMs);
        };

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
        /**
         * 세션이 왜 사라졌는지를 가진 증거로 가른다.
         *
         * 2026-09-02 첫 실제 보고(Samsung Internet·Android 10, /employee/today)에서 드러난 것:
         * 원인이 무엇이든 전부 같은 error 이슈로 올라가 고우선 알림 메일이 왔다. 그런데 이 중
         * 서버가 의도한 결과(계정 비활성화·토큰 폐기)는 운영자가 할 일이 없는 사건이다.
         * 갈라 두지 않으면 진짜 결함(저장소 소멸·SDK 오동작)이 그 사이에 묻힌다.
         */
        const classifySignOut = (): { cause: SignOutCause; detail?: string } => {
            const failure = getLastTokenRefreshFailure();
            // fatal이면 이 실패가 로그아웃의 직접 원인이다(SDK가 스스로 signOut 한다).
            if (failure?.fatal) return { cause: 'token-invalidated', detail: failure.code };
            const lastDoc = lastUserDocRef.current;
            if (lastDoc?.exists && lastDoc.status === 'disabled') return { cause: 'account-disabled' };
            // 문서가 확정적으로 없었다 — 기관 삭제·탈퇴·영구 삭제로 계정 자체가 정리된 경로
            if (lastDoc && !lastDoc.exists) return { cause: 'account-removed' };
            return { cause: 'unknown' };
        };

        const reportUnexpectedSignOut = (uid: string) => {
            if (wasIntentionalLogout()) return;

            const now = Date.now();
            const failure = getLastTokenRefreshFailure();
            const denied = lastDeniedRef.current;
            const { cause, detail } = classifySignOut();
            const context = {
                uid,
                cause,
                detail: detail ?? null,
                sessionAgeMs: sessionStartedAtRef.current ? now - sessionStartedAtRef.current : null,
                tokenRefreshFailure: failure
                    ? { code: failure.code, fatal: failure.fatal, agoMs: now - failure.at }
                    : null,
                lastPermissionDenied: denied
                    ? { scope: denied.scope, agoMs: now - denied.at }
                    : null,
                lastUserDoc: lastUserDocRef.current,
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
        };

        /** 로그아웃 상태를 화면에 확정 반영한다. */
        const commitSignedOut = () => {
            pauseWatches = null;
            resumeWatches = null;
            if (unsubscribeUser) { unsubscribeUser(); unsubscribeUser = null; }
            if (unsubscribeOrg) { unsubscribeOrg(); unsubscribeOrg = null; }
            authedUidRef.current = null;
            sessionStartedAtRef.current = null;
            setUser(null);
            setUserData(null);
            setUserDocState('pending');
            setOrgDeleted(false);
            setOrgFeatures(ALL_FEATURES_ON);
            setLoading(false);
            setSentryUser(null); // 로그아웃 시 Sentry 컨텍스트 해제
        };

        // persistence 설정 완료 후 onAuthStateChanged 구독 시작
        // 이를 통해 새 탭에서도 localStorage의 기존 세션이 올바르게 복원된다.
        authReady.then(() => {
            if (cancelled) return;

            // Redirect 로그인 복귀 시 에러 확인 (정상 인증은 onAuthStateChanged가 처리)
            handleRedirectResult().catch((err) => {
                console.error('Redirect 로그인 에러:', err);
            });

            unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
                // 익명 사용자는 OrgApplicationPage의 Storage 업로드 용도로만 사용되며,
                // 앱 라우팅에서는 비로그인으로 취급한다.
                const isAuthed = !!firebaseUser && !firebaseUser.isAnonymous;

                // ── 인증 확립 후의 null은 유예를 두고 확정한다 ──
                // 화면·리스너를 **건드리지 않고** 돌아간다. 세션이 돌아오면 아래 clearTimeout으로
                // 취소되어 사용자는 아무 변화도 보지 않는다(플래시 없음).
                if (!isAuthed && authedUidRef.current) {
                    if (dropTimer) return; // 이미 유예 중 — 타이머를 뒤로 미루지 않는다
                    const droppedUid = authedUidRef.current;
                    dropTimer = setTimeout(() => {
                        dropTimer = null;
                        if (cancelled) return;
                        // 유예가 지났는데도 세션이 없으면 진짜 로그아웃이다
                        if (auth.currentUser && !auth.currentUser.isAnonymous) return;
                        console.debug('[Auth] 세션이 유예 안에 돌아오지 않아 로그아웃으로 확정합니다');
                        // 확정 전에 보고한다 — commitSignedOut이 uid·세션 시각을 지운다.
                        reportUnexpectedSignOut(droppedUid);
                        // 확정 직후 같은 세션이 돌아오면 저장소 일시 장애였다는 뜻 — 아래 복귀 감지가 쓴다.
                        recentDropRef.current = { uid: droppedUid, at: Date.now() };
                        commitSignedOut();
                    }, AUTH_DROP_GRACE_MS);
                    return;
                }

                if (dropTimer) { clearTimeout(dropTimer); dropTimer = null; }

                // 이전 리스너 해제
                if (unsubscribeUser) { unsubscribeUser(); unsubscribeUser = null; }
                if (unsubscribeOrg) { unsubscribeOrg(); unsubscribeOrg = null; }

                if (isAuthed) {
                    // 같은 세션이 다시 발화한 경우(유예 중 복귀·토큰 재확인)에는 라우팅 상태를
                    // 되돌리지 않는다. setLoading(true)로 되돌리면 로그인 플래시가 스피너
                    // 플래시로 바뀔 뿐이다 — 이미 판정된 화면을 그대로 두고 리스너만 다시 건다.
                    const sameSession = authedUidRef.current === firebaseUser!.uid;

                    // 로그아웃으로 확정한 세션이 곧바로 돌아왔다 — 진짜 소멸이 아니라 저장소 일시 장애다.
                    // 앞서 나간 '예기치 않은 종료' 보고와 짝을 맞춰 남긴다(같은 uid·간격). 이 기록이
                    // 쌓이면 유예를 늘리는 근거가 되고, 없으면 그 가설을 접을 근거가 된다.
                    const dropped = recentDropRef.current;
                    if (dropped) {
                        recentDropRef.current = null;
                        const gapMs = Date.now() - dropped.at;
                        if (dropped.uid === firebaseUser!.uid && gapMs < SESSION_RESTORE_WINDOW_MS) {
                            captureWarning('[Auth] 로그아웃 확정 후 같은 세션이 복귀', {
                                uid: firebaseUser!.uid,
                                gapMs,
                                visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
                                online: typeof navigator !== 'undefined' ? navigator.onLine : null,
                            });
                        }
                    }

                    authedUidRef.current = firebaseUser!.uid;
                    if (!sameSession) sessionStartedAtRef.current = Date.now();
                    setUser(firebaseUser);
                    if (!sameSession) {
                        setUserDocState('pending'); // 새 세션: 문서 로딩 확정 전까지 라우팅 보류
                        setLoading(true); // Firestore 데이터를 가져오기 전까지 라우팅 판단을 대기시킴
                    }

                    const startUserWatch = (retryCount = 0) => {
                        if (!canWatch()) return;
                        unsubscribeUser = onSnapshot(
                            doc(db, 'users', firebaseUser.uid),
                            (docSnap) => {
                                if (docSnap.exists()) {
                                    const data = { id: docSnap.id, ...docSnap.data() } as UserDoc;
                                    lastUserDocRef.current = { exists: true, status: data.status as string | undefined };
                                    setUserData(data);
                                    setUserDocState('present');
                                    // Sentry 사용자 컨텍스트 설정 (에러 추적 시 역할/기관 파악)
                                    setSentryUser({ uid: firebaseUser.uid, email: firebaseUser.email || '', role: data.role, organizationId: data.organizationId || '' });

                                    // Custom Claims 토큰 갱신: 초기 로드 또는 role/orgId 변경 시 강제 갱신
                                    const prev = prevClaimsRef.current;
                                    const isInitialLoad = prev.role === undefined;
                                    const isClaimsChanged = !isInitialLoad && (prev.role !== data.role || prev.orgId !== data.organizationId);
                                    prevClaimsRef.current = { role: data.role, orgId: data.organizationId || undefined };

                                    // 초기 로드 시: 토큰 갱신 완료까지 loading 유지 (대시보드의 Claims 의존 쿼리 보호)
                                    // 이후 변경 시: fire-and-forget (이미 화면 로드됨)
                                    const finishLoading = () => {
                                        // 기관 상태 실시간 감시 (soft delete 감지 + 기능 토글 반영)
                                        // 슈퍼관리자도 본인 소속 기관을 볼 때 기능 토글이 반영되도록 구독한다.
                                        // 단, soft-delete 로그아웃(orgDeleted)은 슈퍼관리자에게 적용하지 않는다.
                                        if (data.organizationId) {
                                            if (unsubscribeOrg) unsubscribeOrg();

                                            const isSuper = data.role === 'superAdmin';

                                            const startOrgWatch = (orgRetryCount = 0) => {
                                                if (!canWatch()) return;
                                                unsubscribeOrg = onSnapshot(
                                                    doc(db, 'organizations', data.organizationId!),
                                                    (orgSnap) => {
                                                        if (orgSnap.exists()) {
                                                            if (!isSuper) setOrgDeleted(orgSnap.data().status === 'deleted');
                                                            setOrgFeatures(resolveOrgFeatures(orgSnap.data()));
                                                            setOrgSites(resolveOrgSites(orgSnap.data()));
                                                        } else {
                                                            if (!isSuper) setOrgDeleted(true);
                                                            setOrgFeatures(ALL_FEATURES_ON);
                                                            setOrgSites(resolveOrgSites(null));
                                                        }
                                                    },
                                                    (err) => {
                                                        console.error('기관 상태 감시 실패:', err);
                                                        const errCode = (err as { code?: string })?.code;
                                                        // 세션 소멸도 permission-denied를 낳는다 — 어느 쪽이 먼저였는지
                                                        // 판별하려면 시점이 필요하다(예기치 않은 종료 보고에 실린다).
                                                        if (errCode === 'permission-denied') {
                                                            lastDeniedRef.current = { scope: 'org', at: Date.now() };
                                                        }
                                                        if (errCode === 'permission-denied' && orgRetryCount < 2) {
                                                            if (unsubscribeOrg) { unsubscribeOrg(); unsubscribeOrg = null; }
                                                            const waitMs = 1000 * 2 ** orgRetryCount;
                                                            refreshToken(firebaseUser)
                                                                .catch(() => {}) // 토큰 갱신 실패해도 재시도
                                                                .then(() => scheduleWatchRetry(firebaseUser.uid, waitMs, () => startOrgWatch(orgRetryCount + 1)));
                                                        } else if (errCode === 'permission-denied') {
                                                            console.warn('[Auth] 기관 상태 감시 — 권한 오류 발생. 세션 유지 및 데이터 로딩 보류');
                                                            notifyAccessDenied('org', '데이터 접근 권한이 없거나 오프라인 상태입니다. (페이지 새로고침 요망)', 'warning');
                                                            // auth.signOut().catch(() => {}); 무한루프 방지를 위해 로그아웃 제거
                                                        }
                                                    }
                                                );
                                            };

                                            const createdAt = data.createdAt;
                                            const createdMillis = (createdAt && typeof createdAt === 'object' && 'toMillis' in createdAt)
                                                ? (createdAt as { toMillis: () => number }).toMillis()
                                                : (createdAt instanceof Date ? createdAt.getTime() : 0);

                                            const isNewlyCreated = createdMillis > 0 && (Date.now() - createdMillis) < 5000;

                                            if (isNewlyCreated) {
                                                setTimeout(startOrgWatch, 500);
                                            } else {
                                                startOrgWatch();
                                            }
                                        }
                                        setLoading(false);
                                    };

                                    if (isInitialLoad || isClaimsChanged) {
                                        if (isInitialLoad) {
                                            // 캐시된 토큰의 Claims와 DB 데이터가 불일치하면 백그라운드에서 갱신.
                                            // 첫 쿼리가 permission-denied를 받으면 onSnapshot err 핸들러의
                                            // retry+refresh가 자동 복구하므로, 로딩을 막지 않는다.
                                            firebaseUser.getIdTokenResult(false)
                                                .then(tokenResult => {
                                                    const claims = tokenResult.claims;
                                                    if (claims.orgId !== data.organizationId || claims.role !== data.role) {
                                                        console.debug('[Auth] 로컬 Claims 불일치 감지. 백그라운드 토큰 갱신');
                                                        return refreshToken(firebaseUser);
                                                    }
                                                })
                                                .catch(() => {});
                                        } else {
                                            // 이후 변경: fire-and-forget. 갱신 실패 시 토스트로 안내
                                            refreshTokenSilently(firebaseUser, () => {
                                                useToastStore.getState().showToast(
                                                    '권한 정보 갱신에 실패했습니다. 다시 로그인해 주세요.',
                                                    'warning'
                                                );
                                            });
                                        }
                                    }
                                    finishLoading();
                                } else {
                                    // 사용자 문서가 없거나 삭제됨
                                    // orgWatch가 남아있으면 orgDeleted=true를 계속 세팅하므로 반드시 해제
                                    if (unsubscribeOrg) { unsubscribeOrg(); unsubscribeOrg = null; }
                                    lastUserDocRef.current = { exists: false };
                                    setUserData(null);
                                    setUserDocState('absent'); // 문서가 확정적으로 없음 → 신규가입/온보딩 대상
                                    setOrgDeleted(false);
                                    setOrgFeatures(ALL_FEATURES_ON);
                                    setLoading(false);
                                }
                            },
                            (err: { code?: string }) => {
                                if (err?.code === 'permission-denied') {
                                    lastDeniedRef.current = { scope: 'user', at: Date.now() };
                                }
                                if (err?.code === 'permission-denied' && retryCount < 2) {
                                    // 캐시된 세션의 낡은 토큰일 수 있음 → 토큰 갱신 후 재시도
                                    console.debug(`[Auth] 사용자 데이터 접근 권한 없음 — 토큰 갱신 후 재시도 (${retryCount + 1}/2)`);
                                    if (unsubscribeUser) { unsubscribeUser(); unsubscribeUser = null; }
                                    const waitMs = 1000 * 2 ** retryCount;
                                    const retryUserWatch = () => scheduleWatchRetry(
                                        firebaseUser.uid,
                                        waitMs,
                                        () => startUserWatch(retryCount + 1),
                                    );
                                    refreshToken(firebaseUser)
                                        .then(retryUserWatch)
                                        .catch(retryUserWatch); // 토큰 갱신 실패해도 재시도
                                } else if (err?.code === 'permission-denied') {
                                    // 재시도 소진 시 강제 로그아웃(무한루프) 방지. 대신 세션 유지하고 데이터만 null 처리.
                                    console.error('[Auth] 사용자 데이터 접근 권한 오류 — 갱신 실패. 관리자에게 문의하세요.', err);
                                    notifyAccessDenied('user', '데이터 접근 권한이 없거나 네트워크 설정 문제가 있습니다. (App Check 또는 권한 확인 필요)', 'error');
                                    setUserData(null);
                                    setLoading(false);
                                } else {
                                    console.error('사용자 데이터 실시간 감시 실패:', err);
                                    setUserData(null);
                                    setLoading(false);
                                }
                            }
                        );
                    };

                    // visibility 상태에 따른 구독 제어
                    pauseWatches = () => {
                        if (unsubscribeUser) { unsubscribeUser(); unsubscribeUser = null; }
                        if (unsubscribeOrg) { unsubscribeOrg(); unsubscribeOrg = null; }
                    };

                    resumeWatches = () => {
                        if (unsubscribeUser) return; // 이미 구독중이면 무시
                        startUserWatch();
                    };

                    if (document.visibilityState === 'visible') {
                        startUserWatch();
                    }
                } else {
                    // 로그인한 적 없는 상태의 null — 유예 없이 즉시 확정한다
                    commitSignedOut();
                }
            });
        });

        // 탭 복귀 시 토큰 선갱신 및 리스너 재시작 — 백그라운드 탭의 토큰 만료 및 비용 최적화
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                if (auth.currentUser && !auth.currentUser.isAnonymous) {
                    refreshTokenSilently(auth.currentUser);
                }
                if (resumeWatches) resumeWatches();
            } else {
                if (pauseWatches) pauseWatches();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            cancelled = true;
            clearTimeout(timeout);
            if (dropTimer) { clearTimeout(dropTimer); dropTimer = null; }
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (unsubscribeAuth) unsubscribeAuth();
            if (unsubscribeUser) unsubscribeUser();
            if (unsubscribeOrg) unsubscribeOrg();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * @deprecated onSnapshot 구독이 자동으로 처리하므로 더 이상 사용하지 않습니다.
     * 인터페이스 호환성을 위해 유지합니다.
     */
    const refreshUserData = async (): Promise<void> => {
        // onSnapshot이 자동으로 처리하므로 수동 새로고침 불필요
        // 호환성을 위해 빈 함수 유지
    };

    const isSuperAdmin = userData?.role === 'superAdmin';


    const value = {
        user,
        userData,
        userDocState,
        loading,
        isSuperAdmin,
        orgDeleted,
        orgFeatures,
        orgSites,
        refreshUserData,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth는 AuthProvider 내부에서 사용해야 합니다');
    }
    return context;
}
