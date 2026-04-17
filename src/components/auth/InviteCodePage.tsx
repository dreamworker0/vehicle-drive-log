import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';
import { logout } from '../../lib/auth';
import { auth } from '../../lib/firebase';
import { refreshTokenSilently } from '../../lib/tokenRefresh';

export default function InviteCodePage() {
    const { user } = useAuth();
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const autoSubmitDone = useRef(false);

    // localStorage에서 초대 코드 자동 입력 (리다이렉트 초기화 방지)
    useEffect(() => {
        const savedCode = localStorage.getItem('pendingInviteCode');
        if (savedCode && !autoSubmitDone.current) {
            const cleaned = savedCode.replace(/\s/g, '').toUpperCase().slice(0, 6);
            setCode(cleaned);
            localStorage.removeItem('pendingInviteCode');
        }
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (code.length !== 6) {
            setError('6자리 초대 코드를 입력해주세요.');
            return;
        }

        // 익명 사용자 가입 차단
        if (user?.isAnonymous) {
            setError('Google 계정으로 로그인 후 다시 시도해주세요.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const functions = getFunctions(undefined, 'asia-northeast3');
            const joinOrg = httpsCallable(functions, 'joinOrganization');
            await joinOrg({ code: code.toUpperCase() });

            // Custom Claims 갱신을 위해 토큰 강제 리프레시
            if (auth.currentUser) await refreshTokenSilently(auth.currentUser);

            // onSnapshot이 자동으로 userData를 업데이트하므로 잠시 대기
            await new Promise(resolve => setTimeout(resolve, 1000));
            navigate('/', { replace: true });
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
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-surface-50 to-primary-50 px-4">
            <div className="w-full max-w-sm animate-scale-in">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 mx-auto mb-4 bg-primary-100 rounded-2xl flex items-center justify-center">
                        <svg className="w-8 h-8 text-primary-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
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
                            className="w-10 h-10 rounded-full bg-surface-200"
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
                                className="input text-center text-2xl tracking-[0.5em] font-mono uppercase"
                                placeholder="______"
                                maxLength={6}
                                autoFocus
                            />
                        </div>

                        {error && (
                            <p className="text-sm text-red-500 animate-slide-down">{error}</p>
                        )}

                        <button
                            type="submit"
                            disabled={loading || code.length !== 6}
                            className="btn-primary w-full"
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
                                    className="btn-primary w-full shadow-sm text-sm"
                                >
                                    Google 계정으로 로그인하기
                                </button>
                            </div>
                        ) : (
                            <div className="mt-4 pt-4 border-t border-surface-100 dark:border-surface-700 space-y-3">
                                <button
                                    onClick={() => navigate('/apply')}
                                    className="btn-secondary w-full text-sm py-2.5 font-medium border-primary-200 text-primary-700 hover:bg-primary-50 dark:border-primary-800 dark:text-primary-300 dark:hover:bg-primary-900/30"
                                >
                                    초대 코드가 없나요? 새 기관 등록 신청하기
                                </button>
                                <button
                                    onClick={logout}
                                    className="btn-ghost w-full text-sm text-surface-400 hover:text-red-500"
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
