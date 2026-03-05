/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext(null);

// Provider를 JSX로 감싸는 컴포넌트
export function ToastProviderWrapper({ children }) {
    const [toasts, setToasts] = useState([]);

    /**
     * 토스트 메시지를 표시한다.
     * @param {string} message - 표시할 메시지
     * @param {string} type - 'info' | 'success' | 'warning' | 'error'
     * @param {number|Object} options - 지속 시간(ms) 또는 옵션 객체
     * @param {number} [options.duration=3000] - 지속 시간
     * @param {string} [options.actionLabel] - 액션 버튼 텍스트 (예: '재시도')
     * @param {Function} [options.onAction] - 액션 버튼 클릭 콜백
     */
    const showToast = useCallback((message, type = 'info', options = 3000) => {
        const id = Date.now() + Math.random();
        const config = typeof options === 'number'
            ? { duration: options }
            : { duration: 5000, ...options };

        setToasts(prev => [...prev, {
            id, message, type,
            actionLabel: config.actionLabel || null,
            onAction: config.onAction || null,
        }]);

        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, config.duration);
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const handleAction = useCallback((toast) => {
        removeToast(toast.id);
        if (toast.onAction) toast.onAction();
    }, [removeToast]);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {/* 토스트 렌더링 */}
            {toasts.length > 0 && (
                <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
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

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        // fallback — context 밖에서 호출 시 console로 폴백
        return {
            showToast: (message, type) => {
                if (type === 'error') console.error(message);
                else console.log(message);
            }
        };
    }
    return context;
}
