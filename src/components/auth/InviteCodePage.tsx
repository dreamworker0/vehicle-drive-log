import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';
import { logout } from '../../lib/auth';
import { auth } from '../../lib/firebase';
import { refreshTokenSilently } from '../../lib/tokenRefresh';

export default function InviteCodePage() {
    const { user } = useAuth();
    const [code, setCode] = useState(() => {
        // 1. URL 파라미터가 가장 우선순위 (마운트 시점에 App.tsx가 아직 URL을 비우지 않았을 경우)
        const params = new URLSearchParams(window.location.search);
        const urlCode = params.get('code');
        if (urlCode) return urlCode.replace(/\s/g, '').toUpperCase().slice(0, 6);

        // 2. localStorage 확인 (리다이렉트 등으로 URL에서 파라미터가 유실되었을 경우 복원)
        const savedCode = localStorage.getItem('pendingInviteCode');
        if (savedCode) return savedCode.replace(/\s/g, '').toUpperCase().slice(0, 6);

        return '';
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // 링크에 코드가 있으면 입력 화면 없이 자동으로 기관 연결을 시도한다.
    // 코드가 없으면(직접 접속) 곧바로 입력 폼을 노출한다.
    const [autoJoining, setAutoJoining] = useState(() => code.length === 6);
    const autoTriedRef = useRef(false);
    const navigate = useNavigate();

    // 코드 값을 성공적으로 불러왔다면, 더 이상 불필요하므로 정리
    useEffect(() => {
        if (code) {
            localStorage.removeItem('pendingInviteCode');
        }
    }, [code]);

    const joinWithCode = useCallback(async (rawCode: string): Promise<boolean> => {
        const finalCode = rawCode.replace(/\s/g, '').toUpperCase();
        if (finalCode.length !== 6) {
            setError('6자리 초대 코드를 입력해주세요.');
            return false;
        }

        // 익명 사용자 가입 차단
        if (user?.isAnonymous) {
            setError('Google 계정으로 로그인 후 다시 시도해주세요.');
            return false;
        }

        setLoading(true);
        setError('');

        try {
            const functions = getFunctions(undefined, 'asia-northeast3');
            const joinOrg = httpsCallable(functions, 'joinOrganization');
            await joinOrg({ code: finalCode });

            // Custom Claims 갱신을 위해 토큰 강제 리프레시
            if (auth.currentUser) await refreshTokenSilently(auth.currentUser);

            // onSnapshot이 자동으로 userData를 업데이트하므로 잠시 대기
            await new Promise(resolve => setTimeout(resolve, 1000));
            navigate('/', { replace: true });
            return true;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : '';
            // Cloud Function에서 반환한 에러 메시지 그대로 표시
            if (message.includes('유효하지 않은') || message.includes('초대 코드')) {
                setError('유효하지 않은 초대 코드입니다.');
            } else if (message.includes('이미 기관에')) {
                setError('이미 기관에 소속되어 있습니다. 로그아웃 후 다시 로그인해 주세요.');
            } else if (message.includes('Google 계정')) {
                setError('Google 계정으로 로그인 후 다시 시도해주세요.');
            } else {
                setError('오류가 발생했습니다. 다시 시도해주세요.');
            }
            console.debug('[InviteCode] 가입 실패:', message || err);
            return false;
        } finally {
            setLoading(false);
        }
    }, [user, navigate]);

    // 링크로 전달된 코드 자동 가입 처리
    useEffect(() => {
        if (!autoJoining || autoTriedRef.current) return;
        if (!user) return; // 인증 정보 로딩 대기

        // 로그인이 필요하거나 코드가 불완전하면 입력 폼으로 폴백
        if (user.isAnonymous || code.length !== 6) {
            setAutoJoining(false);
            return;
        }

        autoTriedRef.current = true;
        joinWithCode(code).then((ok) => {
            // 실패(잘못된/만료된 코드 등) 시 입력 폼을 노출해 직접 수정하도록 한다.
            if (!ok) setAutoJoining(false);
        });
    }, [autoJoining, user, code, joinWithCode]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await joinWithCode(code);
    };

    // 링크 코드 자동 연결 중에는 입력 화면 대신 진행 상태만 보여준다.
    if (autoJoining) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-surface-50 to-primary-50 px-4">
                <div className="w-full max-w-sm animate-scale-in text-center">
                    <div className="w-16 h-16 mx-auto mb-4 bg-primary-100 dark:bg-primary-900/40 rounded-2xl flex items-center justify-center">
                        <div className="w-8 h-8 spinner text-primary-600 dark:text-primary-400" />
                    </div>
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-1">기관에 연결 중...</h1>
                    <p className="text-sm text-surface-500 dark:text-surface-400">
                        초대 코드를 확인하고 기관에 자동으로 연결하고 있어요.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-surface-50 to-primary-50 px-4">
            <div className="w-full max-w-sm animate-scale-in">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 mx-auto mb-4 bg-primary-100 dark:bg-primary-900/40 rounded-2xl flex items-center justify-center">
                        <svg aria-hidden="true" className="w-8 h-8 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25z" />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-1">초대 코드 입력</h1>
                    <p className="text-sm text-surface-500 dark:text-surface-400">
                        기관에서 받은 6자리 코드를 입력하세요
                    </p>
                </div>

                <div className="glass-card p-6">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-surface-100 dark:border-surface-700">
                        <img
                            src={user?.photoURL || ''}
                            alt=""
                            className="w-10 h-10 rounded-full bg-surface-200 dark:bg-surface-700"
                        />
                        <div>
                            <p className="text-sm font-medium text-surface-800 dark:text-surface-200">{user?.displayName}</p>
                            <p className="text-xs text-surface-500 dark:text-surface-400">{user?.email}</p>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="label">초대 코드</label>
                            <input
                                type="text"
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\s/g, '').toUpperCase().slice(0, 6))}
                                className="input text-center text-2xl tracking-[0.5em] font-mono uppercase min-h-[48px]"
                                placeholder="______"
                                maxLength={6}
                            />
                        </div>

                        {error && (
                            <p className="text-sm text-red-500 dark:text-red-400 animate-slide-down">{error}</p>
                        )}

                        <button
                            type="submit"
                            disabled={loading || code.length !== 6}
                            className="btn-primary w-full min-h-[48px]"
                        >
                            {loading ? (
                                <>
                                    <div className="w-4 h-4 spinner" />
                                    확인 중...
                                </>
                            ) : '기관 참여하기'}
                        </button>
                    </form>

                        {user?.isAnonymous ? (
                            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-xl p-4 mt-6 animate-fade-in text-center">
                                <p className="text-sm text-amber-800 dark:text-amber-200 mb-3 font-medium">안전한 사용을 위해 로그인이 필요합니다.</p>
                                <button
                                    onClick={() => {
                                        if (code) localStorage.setItem('pendingInviteCode', code);
                                        logout().then(() => navigate('/login'));
                                    }}
                                    className="btn-primary w-full shadow-sm text-sm min-h-[48px]"
                                >
                                    Google 계정으로 로그인하기
                                </button>
                            </div>
                        ) : (
                            <div className="mt-4 pt-4 border-t border-surface-100 dark:border-surface-700 space-y-3">
                                <button
                                    onClick={() => navigate('/apply')}
                                    className="btn-secondary w-full text-sm py-2.5 font-medium border-primary-200 text-primary-700 hover:bg-primary-50 dark:border-primary-800 dark:text-primary-300 dark:hover:bg-primary-900/30 min-h-[48px]"
                                >
                                    초대 코드가 없나요? 새 기관 등록 신청하기
                                </button>
                                <button
                                    onClick={logout}
                                    className="btn-ghost w-full text-sm text-surface-400 dark:text-surface-500 hover:text-red-500 dark:hover:text-red-400 min-h-[48px]"
                                >
                                    다른 계정으로 로그인
                                </button>
                            </div>
                        )}
                </div>
            </div>
        </div>
    );
}
