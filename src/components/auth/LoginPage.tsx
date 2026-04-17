import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithGoogle } from '../../lib/auth';
import { isInAppBrowser, openInExternalBrowser, copyUrlToClipboard } from '../../lib/inAppBrowser';
import useForceLightMode from '../../hooks/useForceLightMode';
import SEOHead from '../common/SEOHead';

export default function LoginPage() {
    useForceLightMode();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);

    // 인앱 브라우저 여부는 마운트 시 한 번만 판별
    const inApp = useMemo(() => isInAppBrowser(), []);

    const handleGoogleLogin = async () => {
        setLoading(true);
        setError('');
        try {
            await signInWithGoogle();
            // App.jsx에서 역할에 따라 자동 라우팅됨
        } catch (err: unknown) {
            const firebaseErr = err as { code?: string; message?: string };
            if (firebaseErr.code === 'auth/user-disabled') {
                setError('계정이 비활성화되었습니다. 기관 관리자에게 문의하세요.');
            } else {
                setError('로그인에 실패했습니다. 다시 시도해주세요.');
            }
            console.error('Google 로그인 실패:', firebaseErr.code, firebaseErr.message, err);
        } finally {
            setLoading(false);
        }
    };

    /** 공유할 URL 획득 (초대 코드가 세션에 있으면 복원) */
    const getShareUrl = () => {
        const url = new URL(window.location.href);
        const code = sessionStorage.getItem('pendingInviteCode');
        if (code) {
            url.searchParams.set('code', code);
        }
        return url.toString();
    };

    /** 외부 브라우저로 전환 */
    const handleOpenExternal = () => {
        openInExternalBrowser(getShareUrl());
    };

    /** URL 복사 */
    const handleCopyUrl = async () => {
        const ok = await copyUrlToClipboard(getShareUrl());
        if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 px-4">
            <SEOHead
                title="로그인"
                description="Google 계정으로 차량 운행일지에 로그인하세요."
                path="/login"
            />
            {/* 배경 장식 */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-400/20 rounded-full blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-primary-300/10 rounded-full blur-3xl" />
                <div className="absolute top-1/3 left-1/4 w-64 h-64 bg-accent-400/10 rounded-full blur-3xl" />
            </div>

            <div className="relative w-full max-w-sm animate-scale-in">
                {/* 첫 페이지로 돌아가기 */}
                <button
                    onClick={() => navigate('/')}
                    className="flex items-center gap-1.5 text-primary-200/80 hover:text-white text-sm mb-4 transition-colors group"
                >
                    <svg className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                    첫 페이지로
                </button>

                {/* 로고 / 아이콘 영역 */}
                <div className="text-center mb-8">
                    <div className="w-20 h-20 mx-auto mb-4 bg-white/10 dark:bg-surface-800/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20">
                        <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                        </svg>
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">차량 운행일지</h1>
                    <p className="text-primary-200 text-sm">기관 차량 관리를 더 쉽고 스마트하게</p>
                </div>

                {/* 로그인 카드 */}
                <div className="glass-card p-6 space-y-6">
                    {inApp ? (
                        /* ── 인앱 브라우저 안내 UI ── */
                        <>
                            <div className="text-center">
                                <div className="w-12 h-12 mx-auto mb-3 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
                                    <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                                    </svg>
                                </div>
                                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">외부 브라우저 필요</h2>
                                <p className="text-sm text-surface-500 leading-relaxed">
                                    현재 앱 내부 브라우저에서는<br />
                                    Google 로그인이 지원되지 않습니다.
                                </p>
                            </div>

                            {/* 외부 브라우저로 열기 버튼 */}
                            <button
                                onClick={handleOpenExternal}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition-all duration-200 active:scale-[0.98]"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                                </svg>
                                외부 브라우저에서 열기
                            </button>

                            {/* URL 복사 버튼 */}
                            <button
                                onClick={handleCopyUrl}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-surface-200 rounded-xl font-medium text-surface-700 hover:bg-surface-50 hover:shadow-md transition-all duration-200 active:scale-[0.98]"
                            >
                                {copied ? (
                                    <>
                                        <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                        </svg>
                                        복사 완료!
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                                        </svg>
                                        URL 복사하기
                                    </>
                                )}
                            </button>

                            <p className="text-xs text-surface-400 text-center leading-relaxed">
                                복사한 URL을 Chrome 또는 Safari에<br />붙여넣어 접속해주세요.
                            </p>
                        </>
                    ) : (
                        /* ── 일반 브라우저: 기존 Google 로그인 UI ── */
                        <>
                            <div className="text-center">
                                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">시작하기</h2>
                                <p className="text-sm text-surface-500 dark:text-surface-400">Google 계정으로 로그인하세요</p>
                            </div>

                            {error && (
                                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-xl px-4 py-3 text-sm text-red-600 dark:text-red-400 animate-slide-down">
                                    {error}
                                </div>
                            )}

                            <button
                                onClick={handleGoogleLogin}
                                disabled={loading}
                                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-600 rounded-xl font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:bg-surface-800 hover:shadow-md transition-all duration-200 disabled:opacity-50 active:scale-[0.98]"
                            >
                                {loading ? (
                                    <div className="w-5 h-5 spinner" />
                                ) : (
                                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                    </svg>
                                )}
                                {loading ? '로그인 중...' : 'Google로 로그인'}
                            </button>
                        </>
                    )}
                </div>

                <p className="text-center text-primary-200/80 text-xs mt-6 space-x-2">
                    <a href="/terms" className="hover:text-white underline underline-offset-2 transition-colors">이용약관</a>
                    <span className="text-primary-300/40">|</span>
                    <a href="/privacy" className="hover:text-white underline underline-offset-2 transition-colors">개인정보 처리방침</a>
                    <span className="text-primary-300/40">|</span>
                    <a href="/release-notes" className="hover:text-white underline underline-offset-2 transition-colors">업데이트 소식</a>
                    <span className="text-primary-300/40">|</span>
                    <a href="/faq" className="hover:text-white underline underline-offset-2 transition-colors">자주 하는 질문</a>
                </p>

                <p className="text-center text-primary-300/60 text-xs mt-2">
                    © 2026 차량 운행일지. All rights reserved.
                </p>
            </div>
        </div>
    );
}
