import { create } from 'zustand';

export interface ConfirmOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    confirmColor?: 'primary' | 'danger' | 'warning';
}

interface ConfirmState {
    open: boolean;
    options: ConfirmOptions;
    resolveCallback: ((value: boolean) => void) | null;
    
    // Actions
    confirm: (options: ConfirmOptions) => Promise<boolean>;
    handleConfirm: () => void;
    handleCancel: () => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
    open: false,
    options: { message: '' },
    resolveCallback: null,
    
    confirm: (options) => {
        return new Promise<boolean>((resolve) => {
            set({ open: true, options, resolveCallback: resolve });
        });
    },
    
    handleConfirm: () => {
        const { resolveCallback } = get();
        set({ open: false, resolveCallback: null });
        if (resolveCallback) resolveCallback(true);
    },
    
    handleCancel: () => {
        const { resolveCallback } = get();
        set({ open: false, resolveCallback: null });
        if (resolveCallback) resolveCallback(false);
    }
}));
