import { useState, useEffect } from 'react';
import { getPendingCount } from '../../lib/offlineSync';
import { processOfflineQueue } from '../../lib/offlineSyncProcessor';

export default function OfflineBanner() {
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [showReconnected, setShowReconnected] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);
    const [syncedCount, setSyncedCount] = useState(0);

    // 오프라인 시 대기 항목 수 업데이트
    useEffect(() => {
        if (!isOffline) return;
        getPendingCount().then(setPendingCount);
        const interval = setInterval(() => { getPendingCount().then(setPendingCount); }, 3000);
        return () => clearInterval(interval);
    }, [isOffline]);

    useEffect(() => {
        const handleOffline = () => setIsOffline(true);
        const handleOnline = async () => {
            setIsOffline(false);
            // 큐 동기화 실행
            const synced = await processOfflineQueue();
            if (synced > 0) {
                setSyncedCount(synced);
                setShowReconnected(true);
                setTimeout(() => { setShowReconnected(false); setSyncedCount(0); }, 4000);
            } else {
                setShowReconnected(true);
                setTimeout(() => setShowReconnected(false), 3000);
            }
        };

        window.addEventListener('offline', handleOffline);
        window.addEventListener('online', handleOnline);
        return () => {
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('online', handleOnline);
        };
    }, []);

    if (isOffline) {
        return (
            <div
                role="alert"
                aria-live="assertive"
                className="fixed top-0 left-0 right-0 z-[9999] bg-red-500 dark:bg-red-600 text-white text-center py-2 px-4 text-sm font-medium flex items-center justify-center gap-2 animate-fade-in"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                오프라인 상태입니다{pendingCount > 0 ? ` · ${pendingCount}건 전송 대기 중` : ' · 저장한 내용은 연결 복구 시 자동 동기화됩니다'}
            </div>
        );
    }

    if (showReconnected) {
        return (
            <div
                role="status"
                aria-live="polite"
                className="fixed top-0 left-0 right-0 z-[9999] bg-green-500 dark:bg-green-600 text-white text-center py-2 px-4 text-sm font-medium flex items-center justify-center gap-2 animate-fade-in"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
                다시 연결되었습니다!{syncedCount > 0 && ` ${syncedCount}건 자동 동기화 완료`}
            </div>
        );
    }

    return null;
}
