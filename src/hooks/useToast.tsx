import { ReactNode } from 'react';
import { useToastStore, type ToastType, type ToastOptions, type ToastItem } from '../store/useToastStore';

export function ToastProviderWrapper({ children }: { children: ReactNode }) {
    const toasts = useToastStore(state => state.toasts);
    const removeToast = useToastStore(state => state.removeToast);

    const handleAction = (toast: ToastItem) => {
        removeToast(toast.id);
        if (toast.onAction) toast.onAction();
    };

    return (
        <>
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
        </>
    );
}

export function useToast() {
    const showToast = useToastStore(state => state.showToast);
    return { showToast };
}
