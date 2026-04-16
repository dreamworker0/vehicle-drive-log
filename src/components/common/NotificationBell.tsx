import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { subscribeNotifications, markNotificationRead, getNotifications } from '../../lib/firestore';
import type { Notification } from '../../types/notification';

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

function renderMessageWithLinks(text: string) {
    if (!text) return null;
    const parts = text.split(URL_REGEX);
    return parts.map((part, i) => {
        if (part.match(URL_REGEX)) {
            return (
                <a
                    key={i}
                    href={part}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-300 underline break-all"
                    onClick={(e) => e.stopPropagation()}
                >
                    {part}
                </a>
            );
        }
        return <span key={i}>{part}</span>;
    });
}

/** 알림 유형별 아이콘 반환 */
function getNotificationIcon(type?: string) {
    switch (type) {
        case 'feedback_reply': return '💬';
        case 'approval': return '✅';
        case 'rejection': return '❌';
        case 'reservation_cancelled': return '🚫';
        case 'reservation_changed': return '✏️';
        case 'admin_notice': return '📢';
        default: return 'ℹ️';
    }
}

export default function NotificationBell() {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [allNotifications, setAllNotifications] = useState<Notification[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!user) return;
        const unsubscribe = subscribeNotifications(user.uid, (notifs) => {
            setNotifications(notifs as Notification[]);
        });
        return () => unsubscribe();
    }, [user]);

    // 외부 클릭 감지
    const handleClickOutside = useCallback((e: MouseEvent | TouchEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
            setIsOpen(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('touchstart', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [isOpen, handleClickOutside]);

    const handleOpen = async () => {
        setIsOpen(!isOpen);
        if (!isOpen && user) {
            // 읽지 않은 알림 모두 읽음 처리 → 뱃지 숫자 즉시 제거
            for (const n of notifications) {
                markNotificationRead(n.id).catch(() => { });
            }
            const all = await getNotifications(user.uid, 20);
            setAllNotifications((all as Notification[]).map(n => ({ ...n, read: true })));
        }
    };

    const handleMarkRead = async (id: string) => {
        await markNotificationRead(id);
        setAllNotifications(prev =>
            prev.map(n => n.id === id ? { ...n, read: true } : n)
        );
    };

    const unreadCount = notifications.length;

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={handleOpen}
                className="relative btn-icon text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:text-surface-300"
                aria-label={`알림${unreadCount > 0 ? ` (${unreadCount}건 읽지 않음)` : ''}`}
            >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                </svg>
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 dark:bg-red-600 text-white text-xs font-bold rounded-full flex items-center justify-center animate-scale-in">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="notification-dropdown">
                    <div className="p-4 border-b border-surface-100 dark:border-surface-700">
                        <h3 className="font-semibold text-surface-800 dark:text-surface-200">알림</h3>
                    </div>
                    {allNotifications.length === 0 ? (
                        <div className="p-8 text-center text-sm text-surface-400">
                            알림이 없습니다
                        </div>
                    ) : (
                        <div className="divide-y divide-surface-50 dark:divide-surface-700">
                            {allNotifications.map(n => {
                                const icon = getNotificationIcon(n.type);
                                return (
                                    <div
                                        key={n.id}
                                        onClick={() => !n.read && handleMarkRead(n.id)}
                                        className={`p-4 cursor-pointer transition-colors ${n.read ? 'bg-white dark:bg-surface-800' : 'bg-primary-50/50 dark:bg-primary-900/20'
                                            } hover:bg-surface-50 dark:hover:bg-surface-700`}
                                    >
                                        <div className="flex items-start gap-2">
                                            <span className="text-base mt-0.5 flex-shrink-0">{icon}</span>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-surface-800 dark:text-surface-200">{n.title}</p>
                                                <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 break-words whitespace-pre-wrap leading-relaxed">
                                                    {renderMessageWithLinks(n.message)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
