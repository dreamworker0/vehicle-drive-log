/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, createContext, useContext } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { handleRedirectResult, logout } from '../lib/auth';

const AuthContext = createContext(null);




export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [userData, setUserData] = useState(null);
    const [orgDeleted, setOrgDeleted] = useState(false);
    const [loading, setLoading] = useState(true);

    /* eslint-disable react-hooks/exhaustive-deps */
    useEffect(() => {
        // 10초 안에 로딩이 끝나지 않으면 강제 해제
        const timeout = setTimeout(() => {
            if (loading) {
                console.debug('로딩 타임아웃 - Firestore 연결이 느려 로딩을 강제 해제합니다');
                setLoading(false);
            }
        }, 10000);

        // Redirect 로그인 복귀 시 에러 확인 (정상 인증은 onAuthStateChanged가 처리)
        handleRedirectResult().catch((err) => {
            console.error('Redirect 로그인 에러:', err);
        });

        let unsubscribeUser = null;
        let unsubscribeOrg = null;

        const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
            // 이전 리스너 해제
            if (unsubscribeUser) { unsubscribeUser(); unsubscribeUser = null; }
            if (unsubscribeOrg) { unsubscribeOrg(); unsubscribeOrg = null; }

            // 익명 사용자는 OrgApplicationPage의 Storage 업로드 용도로만 사용되며,
            // 앱 라우팅에서는 비로그인으로 취급한다.
            if (firebaseUser && !firebaseUser.isAnonymous) {
                setUser(firebaseUser);

                // 사용자 문서를 실시간 감시 (삭제 시 즉시 감지)
                unsubscribeUser = onSnapshot(
                    doc(db, 'users', firebaseUser.uid),
                    (docSnap) => {
                        if (docSnap.exists()) {
                            const data = { id: docSnap.id, ...docSnap.data() };
                            setUserData(data);

                            // 기관 상태 실시간 감시 (soft delete 감지)
                            // createUser 직후 onSnapshot이 감지되면 Firestore 보안 규칙 캐시가
                            // 아직 갱신되지 않아 permission-denied가 발생할 수 있으므로 딜레이 추가
                            if (data.organizationId && data.role !== 'superAdmin') {
                                if (unsubscribeOrg) unsubscribeOrg();

                                const startOrgWatch = (retryCount = 0) => {
                                    unsubscribeOrg = onSnapshot(
                                        doc(db, 'organizations', data.organizationId),
                                        (orgSnap) => {
                                            if (orgSnap.exists()) {
                                                setOrgDeleted(orgSnap.data().status === 'deleted');
                                            } else {
                                                setOrgDeleted(true);
                                            }
                                        },
                                        (err) => {
                                            console.error('기관 상태 감시 실패:', err);
                                            if (err?.code === 'permission-denied' && retryCount < 1) {
                                                // 1회 재시도: 보안 규칙 캐시 미갱신으로 인한 일시적 에러 대응
                                                if (unsubscribeOrg) { unsubscribeOrg(); unsubscribeOrg = null; }
                                                setTimeout(() => {
                                                    startOrgWatch(retryCount + 1);
                                                }, 1000);
                                            } else if (err?.code === 'permission-denied') {
                                                logout();
                                            }
                                        }
                                    );
                                };

                                // 신규 가입 직후(문서가 방금 생성됨)인지 감지
                                const isNewlyCreated = data.createdAt &&
                                    (Date.now() - (data.createdAt?.toMillis?.() || 0)) < 5000;

                                if (isNewlyCreated) {
                                    setTimeout(startOrgWatch, 500);
                                } else {
                                    startOrgWatch();
                                }
                            }
                        } else {
                            // 사용자 문서가 없거나 삭제됨
                            setUserData(null);
                            setOrgDeleted(false);
                        }
                        setLoading(false);
                    },
                    (err) => {
                        console.error('사용자 데이터 실시간 감시 실패:', err);
                        setUserData(null);
                        setLoading(false);
                        if (err?.code === 'permission-denied') logout();
                    }
                );
            } else {
                setUser(null);
                setUserData(null);
                setOrgDeleted(false);
                setLoading(false);
            }
        });

        return () => {
            clearTimeout(timeout);
            unsubscribeAuth();
            if (unsubscribeUser) unsubscribeUser();
            if (unsubscribeOrg) unsubscribeOrg();
        };
    }, []);
    /* eslint-enable react-hooks/exhaustive-deps */

    const refreshUserData = async () => {
        // onSnapshot이 자동으로 처리하므로 수동 새로고침 불필요
        // 호환성을 위해 빈 함수 유지
    };

    const isSuperAdmin = user?.email === 'ehsheh@gmail.com' ||
        userData?.role === 'superAdmin';


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

