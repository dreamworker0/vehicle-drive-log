import React, { useState, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useNavigate, Navigate } from 'react-router-dom';
import { logout } from '../../lib/auth';
import { auth } from '../../lib/firebase';
import { refreshTokenSilently } from '../../lib/tokenRefresh';
import { TERMS_VERSION } from '../../lib/constants';

export default function InviteCodePage() {
    const { user, userData } = useAuth();
    // 이미 기관에 소속된 멤버(초대 링크로 유입 등)는 여기 있으면 안 된다.
    // 자동 가입이 "이미 소속" 에러로 막다른 길이 되므로 대시보드로 되돌린다.
    const alreadyInOrg = !!userData?.organizationId;
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
    const [agreeTerms, setAgreeTerms] = useState(false);
    /**
     * 초대 링크로 유입됐는지 여부 — 안내 문구만 바꾼다.
     *
     * 종전에는 링크에 코드가 있으면 화면 없이 자동 가입했으나, 약관 동의를 기록하려면
     * 사용자의 명시적 동의가 필요해 확인 단계를 거치도록 바꿨다. 자동 동의는
     * 동의로 볼 수 없으므로 기록의 의미가 없어진다.
     */
    const [fromLink] = useState(() => code.length === 6);
    /*
     * 링크 유입 문구는 마운트 시점 판정만으로 고정하지 않는다. 코드가 틀려 실패한 뒤
     * 사용자가 직접 수정하는 화면에서 "코드를 불러왔어요"가 남으면 어긋난다.
     */
    const showLinkCopy = fromLink && code.length === 6;
    const navigate = useNavigate();

    /*
     * pendingInviteCode는 가입 성공 전까지 지우지 않는다.
     *
     * App이 URL의 ?code=를 localStorage로 옮기고 history.replaceState로 제거하므로,
     * 여기서 지우면 코드는 React state에만 남는다. 자동 가입 시절에는 마운트 직후
     * 소비돼 무해했지만, 이제는 사용자가 약관을 읽고 동의할 때까지 대기한다.
     * 그 사이 약관 링크(_blank)로 외부 브라우저에 나갔다가 PWA가 콜드 재시작되면
     * URL·localStorage·state가 모두 비어 링크만 받은 직원은 코드를 복구할 수 없다.
     */

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

        // 서버(joinOrganization)도 동일하게 검증하므로 우회 시에는 거부된다.
        if (!agreeTerms) {
            setError('이용약관에 동의해주세요.');
            return false;
        }

        setLoading(true);
        setError('');

        try {
            const functions = getFunctions(undefined, 'asia-northeast3');
            const joinOrg = httpsCallable(functions, 'joinOrganization');
            await joinOrg({ code: finalCode, agreedTerms: agreeTerms, termsVersion: TERMS_VERSION });

            // 가입이 확정된 뒤에야 보관된 초대 코드를 정리한다.
            localStorage.removeItem('pendingInviteCode');

            // Custom Claims 갱신을 위해 토큰 강제 리프레시
            if (auth.currentUser) await refreshTokenSilently(auth.currentUser);

            // onSnapshot이 자동으로 userData를 업데이트하므로 잠시 대기
            await new Promise(resolve => setTimeout(resolve, 1000));
            navigate('/', { replace: true });
            return true;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : '';
            // Cloud Function에서 반환한 에러 메시지 그대로 표시
            if (message.includes('비활성화')) {
                setError('비활성화된 계정입니다. 기관 관리자에게 문의해 주세요.');
            } else if (message.includes('유효하지 않은') || message.includes('초대 코드')) {
                setError('유효하지 않은 초대 코드입니다.');
            } else if (message.includes('이미 기관에')) {
                setError('이미 기관에 소속되어 있습니다. 로그아웃 후 다시 로그인해 주세요.');
            } else if (message.includes('Google 계정')) {
                setError('Google 계정으로 로그인 후 다시 시도해주세요.');
            } else if (message.includes('이용약관에 동의') || message.includes('약관 버전')) {
                // 서버 동의 검증 실패. 매핑이 없으면 원인 불명 메시지만 뜨고, 사용자가
                // 재시도를 반복해 uid 기준 rate limit(시간당 5회)에 스스로 갇힌다.
                setError('약관 동의 정보를 확인할 수 없습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.');
            } else {
                setError('오류가 발생했습니다. 다시 시도해주세요.');
            }
            console.debug('[InviteCode] 가입 실패:', message || err);
            return false;
        } finally {
            setLoading(false);
        }
    }, [user, navigate, agreeTerms]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await joinWithCode(code);
    };

    // 이미 소속된 멤버는 초대 코드 화면 대신 대시보드로 (게스트 라우트가 역할별로 재분배)
    if (alreadyInOrg) {
        return <Navigate to="/" replace />;
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
                    <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-1">
                        {showLinkCopy ? '기관 참여 확인' : '초대 코드 입력'}
                    </h1>
                    <p className="text-sm text-surface-500 dark:text-surface-400">
                        {showLinkCopy
                            ? '초대 코드를 불러왔어요. 약관에 동의하면 참여가 완료됩니다.'
                            : '기관에서 받은 6자리 코드를 입력하세요'}
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

                        {/*
                          이용약관 동의 — 개인정보 동의가 아니다. 직원 개인정보의 처리 근거는
                          기관의 업무 수행이고, 정보주체 고지는 위탁자인 기관의 책임이다.
                          여기서 받는 것은 계정 개설과 약관 제4조(이용자의 의무)·제6조(면책)의 효력 근거다.
                        */}
                        <label className="flex items-start gap-3 cursor-pointer group min-h-[48px] py-2">
                            <input
                                id="agree-terms"
                                type="checkbox"
                                checked={agreeTerms}
                                onChange={(e) => setAgreeTerms(e.target.checked)}
                                className="mt-0.5 w-4 h-4 rounded border-surface-300 dark:border-surface-600 text-primary-600 dark:text-primary-400 focus:ring-primary-500"
                            />
                            <span className="text-sm text-surface-600 dark:text-surface-400 group-hover:text-surface-800 dark:group-hover:text-surface-200 transition-colors">
                                <a
                                    href="/terms"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary-600 dark:text-primary-400 underline underline-offset-2 font-medium hover:text-primary-700 dark:hover:text-primary-300"
                                >
                                    이용약관
                                </a>
                                에 동의합니다. <span className="text-red-500 dark:text-red-400">*</span>
                            </span>
                        </label>
                        {/*
                          약관 제9조 ⑦은 기관에 직원 고지 책임을 부과한다. 여기서는 (1) 서비스가
                          수탁자로서 개인정보를 처리한다는 사실, (2) 위탁 계약의 당사자는 기관이므로
                          이 동의가 위탁 동의가 아니라는 점, (3) 동의 기록이 남는다는 점을 밝힌다.
                          (3)은 기관 신청 화면(OrgApplicationPage)과 대칭을 맞춘 것이다.
                        */}
                        <div className="text-xs text-surface-500 dark:text-surface-400 leading-relaxed space-y-1.5">
                            <p>
                                소속 기관이 개인정보처리자이며, 서비스 제공자는 기관의 위탁을 받아 개인정보를 처리하는
                                수탁자입니다. 개인정보의 수집·이용에 관한 고지는 소속 기관이 담당합니다.
                            </p>
                            <p>
                                위탁 계약(약관 제9조)의 당사자는 기관이므로, 위 동의는 서비스 계정 개설을 위한
                                이용약관 동의입니다. 동의 사실과 동의한 문서의 시행일은 기록·보관됩니다.
                            </p>
                        </div>

                        {error && (
                            <p className="text-sm text-red-500 dark:text-red-400 animate-slide-down">{error}</p>
                        )}

                        <button
                            type="submit"
                            disabled={loading || code.length !== 6 || !agreeTerms}
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
