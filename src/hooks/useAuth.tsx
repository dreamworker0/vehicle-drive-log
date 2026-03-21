/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, useRef, createContext, useContext, ReactNode } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { auth, db, authReady } from '../lib/firebase';
import { refreshTokenSilently, refreshToken } from '../lib/tokenRefresh';
import { handleRedirectResult, logout } from '../lib/auth';
import { setSentryUser } from '../lib/sentry';
import type { User as UserDoc } from '../types/user';

interface AuthContextType {
    user: FirebaseUser | null;
    userData: UserDoc | null;
    loading: boolean;
    isSuperAdmin: boolean;
    orgDeleted: boolean;
    refreshUserData: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [userData, setUserData] = useState<UserDoc | null>(null);
    const [orgDeleted, setOrgDeleted] = useState(false);
    const [loading, setLoading] = useState(true);

    // Custom Claims 토큰 갱신을 위한 이전 role/orgId 추적
    const prevClaimsRef = useRef<{ role?: string; orgId?: string }>({});

    /* eslint-disable react-hooks/exhaustive-deps */
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

                    const startUserWatch = (retryCount = 0) => {
                        unsubscribeUser = onSnapshot(
                            doc(db, 'users', firebaseUser.uid),
                            (docSnap) => {
                                if (docSnap.exists()) {
                                    const data = { id: docSnap.id, ...docSnap.data() } as UserDoc;
                                    setUserData(data);
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
                                        // 기관 상태 실시간 감시 (soft delete 감지)
                                        if (data.organizationId && data.role !== 'superAdmin') {
                                            if (unsubscribeOrg) unsubscribeOrg();

                                            const startOrgWatch = (orgRetryCount = 0) => {
                                                unsubscribeOrg = onSnapshot(
                                                    doc(db, 'organizations', data.organizationId!),
                                                    (orgSnap) => {
                                                        if (orgSnap.exists()) {
                                                            setOrgDeleted(orgSnap.data().status === 'deleted');
                                                        } else {
                                                            setOrgDeleted(true);
                                                        }
                                                    },
                                                    (err) => {
                                                        console.error('기관 상태 감시 실패:', err);
                                                        const errCode = (err as { code?: string })?.code;
                                                        if (errCode === 'permission-denied' && orgRetryCount < 1) {
                                                            if (unsubscribeOrg) { unsubscribeOrg(); unsubscribeOrg = null; }
                                                            setTimeout(() => {
                                                                startOrgWatch(orgRetryCount + 1);
                                                            }, 1000);
                                                        } else if (errCode === 'permission-denied') {
                                                            logout();
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
                                            // 초기 로드: 토큰 갱신 완료 후 loading 해제 (재시도 포함)
                                            refreshTokenSilently(firebaseUser)
                                                .finally(() => { finishLoading(); });
                                        } else {
                                            // 이후 변경: fire-and-forget + 즉시 loading 해제
                                            refreshTokenSilently(firebaseUser);
                                            finishLoading();
                                        }
                                    } else {
                                        finishLoading();
                                    }
                                } else {
                                    // 사용자 문서가 없거나 삭제됨
                                    // orgWatch가 남아있으면 orgDeleted=true를 계속 세팅하므로 반드시 해제
                                    if (unsubscribeOrg) { unsubscribeOrg(); unsubscribeOrg = null; }
                                    setUserData(null);
                                    setOrgDeleted(false);
                                    setLoading(false);
                                }
                            },
                            (err: { code?: string }) => {
                                if (err?.code === 'permission-denied' && retryCount < 1) {
                                    // 캐시된 세션의 낡은 토큰일 수 있음 → 토큰 갱신 후 재시도
                                    console.debug('사용자 데이터 접근 권한 없음 — 토큰 갱신 후 재시도');
                                    if (unsubscribeUser) { unsubscribeUser(); unsubscribeUser = null; }
                                    refreshToken(firebaseUser)
                                        .then(() => { startUserWatch(retryCount + 1); })
                                        .catch(() => {
                                            setUserData(null);
                                            setLoading(false);
                                            logout();
                                        });
                                } else if (err?.code === 'permission-denied') {
                                    // 재시도에도 실패 → 로그아웃
                                    console.debug('사용자 데이터 접근 권한 없음 — 로그아웃 처리');
                                    setUserData(null);
                                    setLoading(false);
                                    logout();
                                } else {
                                    console.error('사용자 데이터 실시간 감시 실패:', err);
                                    setUserData(null);
                                    setLoading(false);
                                }
                            }
                        );
                    };

                    startUserWatch();
                } else {
                    setUser(null);
                    setUserData(null);
                    setOrgDeleted(false);
                    setLoading(false);
                    setSentryUser(null); // 로그아웃 시 Sentry 컨텍스트 해제
                }
            });
        });

        return () => {
            cancelled = true;
            clearTimeout(timeout);
            if (unsubscribeAuth) unsubscribeAuth();
            if (unsubscribeUser) unsubscribeUser();
            if (unsubscribeOrg) unsubscribeOrg();
        };
    }, []);
    /* eslint-enable react-hooks/exhaustive-deps */

    const refreshUserData = async () => {
        // onSnapshot이 자동으로 처리하므로 수동 새로고침 불필요
        // 호환성을 위해 빈 함수 유지
    };

    const isSuperAdmin = userData?.role === 'superAdmin';


    const value = {
        user,
        userData,
        loading,
        isSuperAdmin,
        orgDeleted,
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
