import { type ReactNode } from 'react';
import ConfirmModal from '../components/common/ConfirmModal';
import { useConfirmStore, type ConfirmOptions } from '../store/useConfirmStore';

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const { open, options, handleConfirm, handleCancel } = useConfirmStore();

    return (
        <>
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
        </>
    );
}

export function useConfirm() {
    const confirm = useConfirmStore(state => state.confirm);
    return { confirm };
}

