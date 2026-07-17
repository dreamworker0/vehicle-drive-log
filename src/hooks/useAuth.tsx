/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, useRef, createContext, useContext, ReactNode } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { auth, db, authReady } from '../lib/firebase';
import { refreshTokenSilently, refreshToken } from '../lib/tokenRefresh';
import { handleRedirectResult } from '../lib/auth';
import { setSentryUser } from '../lib/sentry';
import { useToastStore } from '../store/useToastStore';
import type { User as UserDoc } from '../types/user';
import { resolveOrgFeatures, ALL_FEATURES_ON, type OrgFeatures } from '../lib/orgFeatures';

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
    /** @deprecated onSnapshot이 자동 처리. 호환성을 위해 유지. */
    refreshUserData: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [userData, setUserData] = useState<UserDoc | null>(null);
    const [userDocState, setUserDocState] = useState<UserDocState>('pending');
    const [orgDeleted, setOrgDeleted] = useState(false);
    const [orgFeatures, setOrgFeatures] = useState<OrgFeatures>(ALL_FEATURES_ON);
    const [loading, setLoading] = useState(true);

    // Custom Claims 토큰 갱신을 위한 이전 role/orgId 추적
    const prevClaimsRef = useRef<{ role?: string; orgId?: string }>({});

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

        // persistence 설정 완료 후 onAuthStateChanged 구독 시작
        // 이를 통해 새 탭에서도 localStorage의 기존 세션이 올바르게 복원된다.
        authReady.then(() => {
            if (cancelled) return;

            // Redirect 로그인 복귀 시 에러 확인 (정상 인증은 onAuthStateChanged가 처리)
            handleRedirectResult().catch((err) => {
                console.error('Redirect 로그인 에러:', err);
            });

            unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
                // 이전 리스너 해제
                if (unsubscribeUser) { unsubscribeUser(); unsubscribeUser = null; }
                if (unsubscribeOrg) { unsubscribeOrg(); unsubscribeOrg = null; }

                // 익명 사용자는 OrgApplicationPage의 Storage 업로드 용도로만 사용되며,
                // 앱 라우팅에서는 비로그인으로 취급한다.
                if (firebaseUser && !firebaseUser.isAnonymous) {
                    setUser(firebaseUser);
                    setUserDocState('pending'); // 새 세션: 문서 로딩 확정 전까지 라우팅 보류
                    setLoading(true); // Firestore 데이터를 가져오기 전까지 라우팅 판단을 대기시킴

                    const startUserWatch = (retryCount = 0) => {
                        unsubscribeUser = onSnapshot(
                            doc(db, 'users', firebaseUser.uid),
                            (docSnap) => {
                                if (docSnap.exists()) {
                                    const data = { id: docSnap.id, ...docSnap.data() } as UserDoc;
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
                                                unsubscribeOrg = onSnapshot(
                                                    doc(db, 'organizations', data.organizationId!),
                                                    (orgSnap) => {
                                                        if (orgSnap.exists()) {
                                                            if (!isSuper) setOrgDeleted(orgSnap.data().status === 'deleted');
                                                            setOrgFeatures(resolveOrgFeatures(orgSnap.data()));
                                                        } else {
                                                            if (!isSuper) setOrgDeleted(true);
                                                            setOrgFeatures(ALL_FEATURES_ON);
                                                        }
                                                    },
                                                    (err) => {
                                                        console.error('기관 상태 감시 실패:', err);
                                                        const errCode = (err as { code?: string })?.code;
                                                        if (errCode === 'permission-denied' && orgRetryCount < 2) {
                                                            if (unsubscribeOrg) { unsubscribeOrg(); unsubscribeOrg = null; }
                                                            const waitMs = 1000 * 2 ** orgRetryCount;
                                                            refreshToken(firebaseUser)
                                                                .catch(() => {}) // 토큰 갱신 실패해도 재시도
                                                                .then(() => setTimeout(() => startOrgWatch(orgRetryCount + 1), waitMs));
                                                        } else if (errCode === 'permission-denied') {
                                                            console.warn('[Auth] 기관 상태 감시 — 권한 오류 발생. 세션 유지 및 데이터 로딩 보류');
                                                            useToastStore.getState().showToast('데이터 접근 권한이 없거나 오프라인 상태입니다. (페이지 새로고침 요망)', 'warning');
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
                                    setUserData(null);
                                    setUserDocState('absent'); // 문서가 확정적으로 없음 → 신규가입/온보딩 대상
                                    setOrgDeleted(false);
                                    setOrgFeatures(ALL_FEATURES_ON);
                                    setLoading(false);
                                }
                            },
                            (err: { code?: string }) => {
                                if (err?.code === 'permission-denied' && retryCount < 2) {
                                    // 캐시된 세션의 낡은 토큰일 수 있음 → 토큰 갱신 후 재시도
                                    console.debug(`[Auth] 사용자 데이터 접근 권한 없음 — 토큰 갱신 후 재시도 (${retryCount + 1}/2)`);
                                    if (unsubscribeUser) { unsubscribeUser(); unsubscribeUser = null; }
                                    const waitMs = 1000 * 2 ** retryCount;
                                    refreshToken(firebaseUser)
                                        .then(() => { setTimeout(() => startUserWatch(retryCount + 1), waitMs); })
                                        .catch(() => {
                                            // 토큰 갱신 실패해도 재시도
                                            setTimeout(() => startUserWatch(retryCount + 1), waitMs);
                                        });
                                } else if (err?.code === 'permission-denied') {
                                    // 재시도 소진 시 강제 로그아웃(무한루프) 방지. 대신 세션 유지하고 데이터만 null 처리.
                                    console.error('[Auth] 사용자 데이터 접근 권한 오류 — 갱신 실패. 관리자에게 문의하세요.', err);
                                    useToastStore.getState().showToast('데이터 접근 권한이 없거나 네트워크 설정 문제가 있습니다. (App Check 또는 권한 확인 필요)', 'error');
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
                    pauseWatches = null;
                    resumeWatches = null;
                    setUser(null);
                    setUserData(null);
                    setUserDocState('pending');
                    setOrgDeleted(false);
                    setOrgFeatures(ALL_FEATURES_ON);
                    setLoading(false);
                    setSentryUser(null); // 로그아웃 시 Sentry 컨텍스트 해제
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
