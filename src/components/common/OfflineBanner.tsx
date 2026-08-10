import { useState, useEffect } from 'react';
import usePendingSyncCount from '../../hooks/usePendingSyncCount';

export default function OfflineBanner() {
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [showReconnected, setShowReconnected] = useState(false);
    const pendingCount = usePendingSyncCount();

    useEffect(() => {
        const handleOffline = () => setIsOffline(true);
        const handleOnline = () => {
            setIsOffline(false);
            setShowReconnected(true);
            setTimeout(() => { setShowReconnected(false); }, 3000);
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
                {pendingCount > 0
                    ? `오프라인 상태입니다 · 미전송 ${pendingCount}건은 연결 복구 시 자동 전송됩니다`
                    : '오프라인 상태입니다 · 저장한 내용은 연결 복구 시 자동 동기화됩니다'}
            </div>
        );
    }

    // 연결은 돌아왔는데 큐가 아직 남은 구간. 여기서 아무것도 띄우지 않으면 "다시 연결되었습니다"가
    // 3초 만에 사라진 뒤 전송이 끝났는지 알 길이 없다 — 0이 될 때까지 남겨 두고 저절로 사라지게 한다.
    if (pendingCount > 0) {
        return (
            <div
                role="status"
                aria-live="polite"
                className="fixed top-0 left-0 right-0 z-[9999] bg-amber-500 dark:bg-amber-600 text-white text-center py-2 px-4 text-sm font-medium flex items-center justify-center gap-2 animate-fade-in"
            >
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                미전송 {pendingCount}건을 전송하는 중입니다
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
                다시 연결되었습니다! 저장된 데이터가 동기화됩니다.
            </div>
        );
    }

    return null;
}
