import { useState, useEffect, useRef, useCallback } from 'react';
import { registerSW } from 'virtual:pwa-register';

export default function UpdatePrompt() {
    const [needRefresh, setNeedRefresh] = useState(false);
    const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

    const handleNeedRefresh = useCallback(() => setNeedRefresh(true), []);

    useEffect(() => {
        let intervalId: ReturnType<typeof setTimeout>;
        const update = registerSW({
            onNeedRefresh: handleNeedRefresh,
            onOfflineReady() {
                console.log('[PWA] 오프라인 사용 준비 완료');
            },
            onRegisteredSW(_swUrl, registration) {
                if (registration) {
                    intervalId = setInterval(() => {
                        registration.update();
                    }, 60 * 60 * 1000);
                }
            },
        });
        updateSWRef.current = update;
        return () => { if (intervalId) clearInterval(intervalId); };
    }, [handleNeedRefresh]);

    if (!needRefresh) return null;

    return (
        <div
            style={{
                position: 'fixed',
                bottom: '1rem',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 9999,
                backgroundColor: '#1e40af',
                color: 'white',
                borderRadius: '0.75rem',
                boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
                padding: '0.875rem 1.25rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                maxWidth: '90vw',
                animation: 'slideUp 0.3s ease-out',
            }}
        >
            <span style={{ fontSize: '1.25rem' }}>🔄</span>
            <span style={{ fontSize: '0.875rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
                앱 업데이트
            </span>
            <button
                onClick={() => updateSWRef.current?.(true)}
                style={{
                    marginLeft: '0.5rem',
                    backgroundColor: 'white',
                    color: '#1e40af',
                    border: 'none',
                    borderRadius: '0.5rem',
                    padding: '0.375rem 0.875rem',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                }}
            >
                적용
            </button>
            <button
                onClick={() => setNeedRefresh(false)}
                style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255,255,255,0.7)',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    padding: '0.25rem',
                    lineHeight: 1,
                }}
                aria-label="닫기"
            >
                ✕
            </button>
            <style>{`
                @keyframes slideUp {
                    from { opacity: 0; transform: translateX(-50%) translateY(1rem); }
                    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
            `}</style>
        </div>
    );
}
