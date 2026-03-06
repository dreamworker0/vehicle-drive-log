import { useState, useEffect, useRef } from 'react';

/**
 * PWA 설치 유도 배너 (안드로이드 Chrome 전용).
 * beforeinstallprompt 이벤트를 캡처하여 커스텀 설치 UI를 표시한다.
 * standalone 모드이거나 이미 설치된 경우 표시하지 않는다.
 */
const DISMISS_KEY = 'pwa-install-dismissed-at';
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000; // 2주(밀리초)

export default function InstallPrompt() {
    const [show, setShow] = useState(false);
    const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

    useEffect(() => {
        // 이미 standalone 모드(설치됨)이면 표시 안 함
        if (window.matchMedia?.('(display-mode: standalone)')?.matches) return;
        if ((navigator as any).standalone) return; // iOS standalone

        // 2주 이내에 닫기를 누른 적이 있으면 표시하지 않음
        const dismissedAt = localStorage.getItem(DISMISS_KEY);
        if (dismissedAt && Date.now() - Number(dismissedAt) < TWO_WEEKS_MS) return;

        const handleBeforeInstall = (e: BeforeInstallPromptEvent) => {
            e.preventDefault();
            deferredPromptRef.current = e;
            setShow(true);
        };

        const handleAppInstalled = () => {
            deferredPromptRef.current = null;
            setShow(false);
        };

        window.addEventListener('beforeinstallprompt' as any, handleBeforeInstall as any);
        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt' as any, handleBeforeInstall as any);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);

    const handleInstall = async () => {
        const prompt = deferredPromptRef.current;
        if (!prompt) return;

        prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') {
            deferredPromptRef.current = null;
            setShow(false);
        }
    };

    const handleDismiss = () => {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
        setShow(false);
    };

    if (!show) return null;

    return (
        <div
            style={{
                position: 'fixed',
                bottom: '4.5rem',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 9998,
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                color: 'white',
                borderRadius: '0.875rem',
                boxShadow: '0 8px 30px rgba(37, 99, 235, 0.35)',
                padding: '0.875rem 1.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                maxWidth: '92vw',
                width: 'max-content',
                animation: 'installSlideUp 0.35s ease-out',
            }}
        >
            <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>📲</span>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                    홈 화면에 추가
                </div>
                <div style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: '0.125rem' }}>
                    앱처럼 빠르게 실행할 수 있습니다
                </div>
            </div>
            <button
                onClick={handleInstall}
                style={{
                    backgroundColor: 'white',
                    color: '#1d4ed8',
                    border: 'none',
                    borderRadius: '0.5rem',
                    padding: '0.4rem 0.875rem',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                }}
            >
                설치
            </button>
            <button
                onClick={handleDismiss}
                style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255,255,255,0.7)',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    padding: '0.25rem',
                    lineHeight: 1,
                    flexShrink: 0,
                }}
                aria-label="닫기"
            >
                ✕
            </button>
            <style>{`
                @keyframes installSlideUp {
                    from { opacity: 0; transform: translateX(-50%) translateY(1rem); }
                    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
            `}</style>
        </div>
    );
}
