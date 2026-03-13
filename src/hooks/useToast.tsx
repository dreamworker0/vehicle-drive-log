/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type ToastType = 'info' | 'success' | 'warning' | 'error';

interface Toast {
    id: number;
    message: string;
    type: ToastType;
    actionLabel: string | null;
    onAction: (() => void) | null;
}

interface ToastOptions {
    duration?: number;
    actionLabel?: string;
    onAction?: () => void;
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType, options?: number | ToastOptions) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

// Provider를 JSX로 감싸는 컴포넌트
export function ToastProviderWrapper({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    /**
     * 토스트 메시지를 표시한다.
     * @param {string} message - 표시할 메시지
     * @param {string} type - 'info' | 'success' | 'warning' | 'error'
     * @param {number|Object} options - 지속 시간(ms) 또는 옵션 객체
     */
    const showToast = useCallback((message: string, type: ToastType = 'info', options: number | ToastOptions = 3000) => {
        const id = Date.now() + Math.random();
        const config: Required<Pick<ToastOptions, 'duration'>> & ToastOptions =
            typeof options === 'number'
                ? { duration: options }
                : { duration: 5000, ...options };

        setToasts(prev => [...prev, {
            id,
            message,
            type,
            actionLabel: config.actionLabel || null,
            onAction: config.onAction || null,
        }]);

        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, config.duration);
    }, []);

    const removeToast = useCallback((id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const handleAction = useCallback((toast: Toast) => {
        removeToast(toast.id);
        if (toast.onAction) toast.onAction();
    }, [removeToast]);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {/* 토스트 렌더링 */}
            {toasts.length > 0 && (
                <div className="fixed right-4 z-[9999] flex flex-col gap-2 max-w-sm" style={{ top: 'calc(1rem + env(safe-area-inset-top, 0px))' }}>
                    {toasts.map(toast => (
                        <div
                            key={toast.id}
                            className={`
                                px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium
                                animate-slide-in flex items-center gap-2
                                ${toast.type === 'error' ? 'bg-red-500' :
                                    toast.type === 'success' ? 'bg-green-500' :
                                        toast.type === 'warning' ? 'bg-yellow-500 text-gray-900' :
                                            'bg-blue-500'}
                            `}
                        >
                            <span className="shrink-0">
                                {toast.type === 'error' ? '❌' :
                                    toast.type === 'success' ? '✅' :
                                        toast.type === 'warning' ? '⚠️' : 'ℹ️'}
                            </span>
                            <span className="flex-1 cursor-pointer" onClick={() => removeToast(toast.id)}>
                                {toast.message}
                            </span>
                            {toast.actionLabel && (
                                <button
                                    onClick={() => handleAction(toast)}
                                    className={`
                                        shrink-0 px-2 py-1 rounded text-xs font-bold
                                        transition-colors duration-150
                                        ${toast.type === 'warning'
                                            ? 'bg-gray-800 text-white hover:bg-gray-700'
                                            : 'bg-white/20 hover:bg-white/30'}
                                    `}
                                >
                                    {toast.actionLabel}
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </ToastContext.Provider>
    );
}

export function useToast(): ToastContextType {
    const context = useContext(ToastContext);
    if (!context) {
        // fallback — context 밖에서 호출 시 console로 폴백
        return {
            showToast: (message: string, type?: ToastType) => {
                if (type === 'error') console.error(message);
                else console.log(message);
            }
        };
    }
    return context;
}
