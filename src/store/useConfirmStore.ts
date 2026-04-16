import { create } from 'zustand';

export interface ConfirmOptions {
    title?: string;
    message: string;
    type?: 'confirm' | 'input';
    inputLabel?: string;
    inputPlaceholder?: string;
    inputDefault?: string;
    confirmText?: string;
    cancelText?: string;
    confirmColor?: 'primary' | 'danger' | 'warning';
}

interface ConfirmState {
    open: boolean;
    options: ConfirmOptions;
    // 입력 모달의 경우 텍스트를, 아니면 boolean을 반환합니다.
    resolveCallback: ((value: boolean | string | null) => void) | null;
    
    // Actions
    // 반환타입을 T로 추론하거나 제약 없이 union 사용
    confirm: (options: ConfirmOptions) => Promise<boolean | string | null>;
    handleConfirm: (value?: string) => void;
    handleCancel: () => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
    open: false,
    options: { message: '' },
    resolveCallback: null,
    
    confirm: (options) => {
        return new Promise<boolean | string | null>((resolve) => {
            set({ open: true, options, resolveCallback: resolve });
        });
    },
    
    handleConfirm: (value?: string) => {
        const { resolveCallback, options } = get();
        set({ open: false, resolveCallback: null });
        if (resolveCallback) {
            // input 타입이고 값이 전달되었으면 string 반환, 없으면 기본적으로 true 반환
            // input이면서 값이 없으면 빈 문자열('') 반환
            if (options.type === 'input') {
                resolveCallback(value ?? '');
            } else {
                resolveCallback(true);
            }
        }
    },
    
    handleCancel: () => {
        const { resolveCallback } = get();
        set({ open: false, resolveCallback: null });
        if (resolveCallback) resolveCallback(false);
    }
}));
