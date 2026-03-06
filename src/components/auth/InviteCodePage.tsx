import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { findOrganizationByInviteCode, createUser, getOrganizationMembers } from '../../lib/firestore';
import { useNavigate } from 'react-router-dom';
import { logout } from '../../lib/auth';

export default function InviteCodePage() {
    const { user, refreshUserData } = useAuth();
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

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
            const org = await findOrganizationByInviteCode(code.toUpperCase());
            if (!org) {
                setError('유효하지 않은 초대 코드입니다.');
                return;
            }

            if (!user?.email || !user?.uid) {
                setError('인증 정보가 부족합니다. 다시 로그인해주세요.');
                return;
            }

            // 기존 직원 목록에서 이메일 매칭 확인
            const members = await getOrganizationMembers(org.id);
            const matchedMember = members.find(m => m.email === user.email);

            // 기관에 admin이 없으면 첫 등록자를 admin으로 설정
            const hasAdmin = members.some(m => m.role === 'admin');
            const role = hasAdmin ? 'employee' : 'admin';

            await createUser(user.uid, {
                email: user.email,
                name: matchedMember?.name || user.displayName || '',
                role,
                organizationId: org.id,
                phone: '',
            });

            // Firestore 보안 규칙 캐시 갱신 대기
            await new Promise(resolve => setTimeout(resolve, 500));

            await refreshUserData();
        } catch (err: any) {
            const errCode = err?.code || '';
            if (errCode === 'permission-denied' || errCode === 'PERMISSION_DENIED') {
                setError('권한이 만료되었습니다. 로그아웃 후 다시 로그인해 주세요.');
            } else {
                setError('오류가 발생했습니다. 다시 시도해주세요.');
            }
            console.error(err);
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
                                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
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

                    <div className="mt-4 pt-4 border-t border-surface-100 dark:border-surface-700 space-y-2">
                        <button
                            onClick={() => navigate('/apply')}
                            className="btn-ghost w-full text-sm"
                        >
                            새 기관 등록 신청하기
                        </button>
                        <button
                            onClick={logout}
                            className="btn-ghost w-full text-sm text-surface-400 hover:text-red-500"
                        >
                            로그아웃
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
