import { create } from 'zustand';
import { isStaleChunkError, STALE_CHUNK_MESSAGE } from '../lib/staleChunk';
import { reloadPage } from '../lib/browserNav';

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

export const useToastStore = create<ToastState>((set, get) => ({
    toasts: [],
    showToast: (message, type = 'info', options = 3000) => {
        // 배포 직후 구버전 청크 실패 원문은 안내 문구 + [새로고침]으로 바꾼다 (staleChunk.ts 참고)
        if (message === STALE_CHUNK_MESSAGE || isStaleChunkError(message)) {
            if (get().toasts.some(t => t.message === STALE_CHUNK_MESSAGE)) return;
            message = STALE_CHUNK_MESSAGE;
            type = 'warning';
            options = { duration: 15000, actionLabel: '새로고침', onAction: reloadPage };
        }
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
