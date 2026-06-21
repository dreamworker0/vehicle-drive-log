/**
 * AccountSection — Settings의 "내 계정" 섹션(로그아웃 + 푸시 알림)
 * 계정/알림은 Settings의 기관 폼 상태와 독립적이므로 필요한 전역 훅을 직접 사용한다.
 */
import { useAuth } from '../../../hooks/useAuth';
import useNotification from '../../../hooks/useNotification';
import { useToast } from '../../../hooks/useToast';
import { logout } from '../../../lib/auth';

export default function AccountSection() {
    const { user } = useAuth();
    const { permission, requestPermission } = useNotification();
    const { showToast } = useToast();
    const notifApiAvailable = typeof window !== 'undefined' && 'Notification' in window;

    const handleNotifClick = () => {
        if (permission === 'default') {
            requestPermission();
            return;
        }
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isAndroid = /Android/.test(navigator.userAgent);
        if (isIOS) {
            showToast('설정 → 알림에서 이 앱의 알림을 변경할 수 있습니다.', 'info');
        } else if (isAndroid) {
            showToast('앱 아이콘을 길게 눌러 앱 정보 → 알림에서 변경할 수 있습니다.', 'info');
        } else {
            showToast('주소창 왼쪽 🔒 아이콘을 눌러 알림을 변경할 수 있습니다.', 'info');
        }
    };

    return (
        <div className="glass-card p-6 mb-6">
            <div className="flex items-center gap-3 p-3">
                <div className="w-10 h-10 bg-primary-100 dark:bg-primary-900/40 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                    </svg>
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{user?.displayName || '이름 없음'}</p>
                    <p className="text-xs text-surface-400 truncate">{user?.email}</p>
                </div>
                <button
                    onClick={logout}
                    className="flex-shrink-0 flex items-center gap-1.5 text-sm font-medium text-red-500 dark:text-red-400 px-4 py-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors min-h-[48px]"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                    </svg>
                    로그아웃
                </button>
            </div>

            {notifApiAvailable && (
                <>
                    <div className="border-t border-surface-100 dark:border-surface-700 my-1 mx-3" />
                    <div
                        role="button"
                        tabIndex={0}
                        className="flex items-center justify-between cursor-pointer rounded-xl p-3 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
                        onClick={handleNotifClick}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleNotifClick();
                            }
                        }}
                    >
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${permission === 'granted' ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-surface-100 dark:bg-surface-800'}`}>
                                <svg className={`w-5 h-5 ${permission === 'granted' ? 'text-blue-500 dark:text-blue-400' : 'text-surface-400 dark:text-surface-500'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                                </svg>
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">푸시 알림</p>
                                <p className="text-xs text-surface-400">예약 알림 및 운행 관련 알림</p>
                            </div>
                        </div>
                        {permission === 'default' ? (
                            <span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 rounded-full">활성화</span>
                        ) : permission === 'granted' ? (
                            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 rounded-full">켜짐</span>
                        ) : (
                            <span className="text-xs font-medium text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2.5 py-1 rounded-full">꺼짐</span>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
