/**
 * IOSInstallPrompt — iOS Safari에서 홈 화면에 추가 안내 배너
 * - iOS Safari + standalone 모드가 아닌 경우에만 표시
 * - 닫으면 localStorage로 7일간 숨김
 */
import { useState, useEffect } from 'react';

const STORAGE_KEY = 'ios-install-prompt-dismissed';
const DISMISS_DAYS = 7;

function isIOSSafari() {
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua);
    const isStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches || (navigator as unknown as { standalone?: boolean }).standalone;
    // iOS Chrome, Firefox 등은 제외 (Safari만 홈화면 추가 지원)
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua);
    return isIOS && isSafari && !isStandalone;
}

export default function IOSInstallPrompt() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!isIOSSafari()) return;

        const dismissed = localStorage.getItem(STORAGE_KEY);
        if (dismissed) {
            const dismissedAt = parseInt(dismissed, 10);
            if (Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000) return;
        }
         
        setVisible(true);
    }, []);

    const handleDismiss = () => {
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
        setVisible(false);
    };

    if (!visible) return null;

    return (
        <div className="mx-4 mt-2 mb-1 animate-slide-down">
            <div className="relative bg-gradient-to-r from-primary-50 to-blue-50 dark:from-primary-950/60 dark:to-blue-950/60 border border-primary-200 dark:border-primary-800 rounded-xl px-4 py-3">
                <button
                    onClick={handleDismiss}
                    className="absolute top-2 right-2 p-1 text-surface-400 hover:text-surface-600 dark:text-surface-500 dark:hover:text-surface-300"
                    aria-label="닫기"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                </button>
                <div className="flex items-start gap-3 pr-6">
                    <div className="w-9 h-9 bg-primary-100 dark:bg-primary-900/50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <svg className="w-5 h-5 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                        </svg>
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-surface-800 dark:text-surface-200">
                            홈 화면에 추가하세요
                        </p>
                        <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5 leading-relaxed">
                            하단 <span className="inline-flex items-center">
                                <svg className="w-3.5 h-3.5 text-primary-600 mx-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15" />
                                </svg>
                            </span> 버튼 → &ldquo;홈 화면에 추가&rdquo;로 앱처럼 사용하고 푸시 알림도 받을 수 있습니다.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
