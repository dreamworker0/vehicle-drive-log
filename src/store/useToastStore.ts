import { create } from 'zustand';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
    duration?: number;
    actionLabel?: string;
    onAction?: () => void;
}

export interface ToastItem {
    id: number;
    message: string;
    type: ToastType;
    actionLabel: string | null;
    onAction: (() => void) | null;
}

interface ToastState {
    toasts: ToastItem[];
    showToast: (message: string, type?: ToastType, options?: number | ToastOptions) => void;
    removeToast: (id: number) => void;
}

export const useToastStore = create<ToastState>((set) => ({
    toasts: [],
    showToast: (message, type = 'info', options = 3000) => {
        const id = Date.now() + Math.random();
        const config: Required<Pick<ToastOptions, 'duration'>> & ToastOptions =
            typeof options === 'number'
                ? { duration: options }
                : { duration: 5000, ...options };

        set((state) => ({
            toasts: [...state.toasts, {
                id,
                message,
                type,
                actionLabel: config.actionLabel || null,
                onAction: config.onAction || null,
            }]
        }));

        setTimeout(() => {
            set((state) => ({
                toasts: state.toasts.filter(t => t.id !== id)
            }));
        }, config.duration);
    },
    removeToast: (id) => set((state) => ({
        toasts: state.toasts.filter(t => t.id !== id)
    })),
}));
