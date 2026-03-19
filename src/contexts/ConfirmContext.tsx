/**
 * ConfirmContext — Promise 기반 커스텀 confirm 모달
 * window.confirm 대신 useConfirm().confirm(options) 를 사용
 */
import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import ConfirmModal from '../components/common/ConfirmModal';

interface ConfirmOptions {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    confirmColor?: 'primary' | 'danger' | 'warning';
}

interface ConfirmContextType {
    confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const [options, setOptions] = useState<ConfirmOptions>({ message: '' });
    const resolveRef = useRef<((value: boolean) => void) | null>(null);

    const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
            setOptions(opts);
            setOpen(true);
            resolveRef.current = resolve;
        });
    }, []);

    const handleConfirm = useCallback(() => {
        setOpen(false);
        resolveRef.current?.(true);
        resolveRef.current = null;
    }, []);

    const handleCancel = useCallback(() => {
        setOpen(false);
        resolveRef.current?.(false);
        resolveRef.current = null;
    }, []);

    return (
        <ConfirmContext.Provider value={{ confirm }}>
            {children}
            <ConfirmModal
                open={open}
                title={options.title}
                message={options.message}
                confirmText={options.confirmText || '확인'}
                cancelText={options.cancelText || '취소'}
                confirmColor={options.confirmColor || 'primary'}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
            />
        </ConfirmContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm() {
    const ctx = useContext(ConfirmContext);
    if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
    return ctx;
}
