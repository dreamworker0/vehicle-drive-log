import { useAuth } from '../../hooks/useAuth';
import { logout } from '../../lib/auth';

export default function PendingApprovalPage() {
    const { user } = useAuth();

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-surface-50 to-amber-50 px-4">
            <div className="w-full max-w-sm text-center animate-scale-in">
                <div className="w-20 h-20 mx-auto mb-6 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
                    <svg className="w-10 h-10 text-amber-600 animate-pulse-soft" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                    </svg>
                </div>
                <h2 className="text-2xl font-bold text-surface-900 dark:text-surface-100 mb-2">승인 대기 중</h2>
                <p className="text-surface-500 dark:text-surface-400 mb-2">
                    기관 신청이 검토 중입니다.
                </p>
                <p className="text-sm text-surface-400 mb-8">
                    승인이 완료되면 알림으로 안내드립니다.
                    <br />보통 1~2일 내에 처리됩니다.
                </p>

                <div className="glass-card p-4 mb-6">
                    <div className="flex items-center gap-3">
                        {user?.photoURL ? (
                            <img
                                src={user.photoURL}
                                alt=""
                                className="w-10 h-10 rounded-full bg-surface-200"
                            />
                        ) : (
                            <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
                                <span className="text-sm font-bold text-primary-600 dark:text-primary-300">
                                    {(user?.displayName || user?.email || '?').charAt(0).toUpperCase()}
                                </span>
                            </div>
                        )}
                        <div className="text-left">
                            <p className="text-sm font-medium text-surface-800 dark:text-surface-200">{user?.displayName || '신청자'}</p>
                            <p className="text-xs text-surface-500 dark:text-surface-400">{user?.email || '이메일 미등록'}</p>
                        </div>
                    </div>
                </div>

                <button
                    onClick={logout}
                    className="btn-ghost text-sm text-surface-400 hover:text-red-500"
                >
                    로그아웃
                </button>
            </div>
        </div>
    );
}
