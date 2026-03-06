/**
 * ConfirmModal — 범용 확인/입력 모달
 * - type="confirm": 단순 확인/취소 (삭제, 복원 등)
 * - type="input": 텍스트 입력 + 확인/취소 (폐차 사유 등)
 */
import { useState, useEffect, useRef } from 'react';

interface Props {
    open: boolean;
    title?: string;
    message?: string;
    type?: 'confirm' | 'input';
    inputLabel?: string;
    inputPlaceholder?: string;
    inputDefault?: string;
    confirmText?: string;
    cancelText?: string;
    confirmColor?: 'primary' | 'danger' | 'warning';
    onConfirm?: (value?: string) => void;
    onCancel?: () => void;
}

export default function ConfirmModal({
    open,
    title,
    message,
    type = 'confirm',
    inputLabel,
    inputPlaceholder = '',
    inputDefault = '',
    confirmText = '확인',
    cancelText = '취소',
    confirmColor = 'primary',
    onConfirm,
    onCancel,
}: Props) {
    const [inputValue, setInputValue] = useState(inputDefault);
    const inputRef = useRef<HTMLInputElement>(null);

    // 모달 열릴 때 기본값 초기화 + 포커스
    /* eslint-disable react-hooks/set-state-in-effect -- 모달 open 시 초기값 동기화 의도적 패턴 */
    useEffect(() => {
        if (open) {
            setInputValue(inputDefault);
            // input 타입이면 다음 렌더 후 포커스
            if (type === 'input') {
                setTimeout(() => inputRef.current?.focus(), 50);
            }
        }
    }, [open, inputDefault, type]);
    /* eslint-enable react-hooks/set-state-in-effect */

    // ESC 키로 닫기
    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel?.();
        };
        window.addEventListener('keydown', handleKeyDown as any);
        return () => window.removeEventListener('keydown', handleKeyDown as any);
    }, [open, onCancel]);

    if (!open) return null;

    const handleConfirm = () => {
        if (type === 'input') {
            onConfirm?.(inputValue);
        } else {
            onConfirm?.();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleConfirm();
    };

    const btnColors = {
        primary: 'btn-primary',
        danger: 'bg-red-500 hover:bg-red-600 text-white dark:bg-red-600 dark:hover:bg-red-700',
        warning: 'bg-amber-500 hover:bg-amber-600 text-white dark:bg-amber-600 dark:hover:bg-amber-700',
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onCancel} role="presentation">
            <div className="glass-card p-6 w-full max-w-sm animate-scale-in" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title" aria-describedby="confirm-modal-desc">
                {title && (
                    <h3 id="confirm-modal-title" className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-2">{title}</h3>
                )}
                {message && (
                    <p id="confirm-modal-desc" className="text-sm text-surface-600 dark:text-surface-300 mb-4 whitespace-pre-line">{message}</p>
                )}
                {type === 'input' && (
                    <div className="mb-4">
                        {inputLabel && <label className="label">{inputLabel}</label>}
                        <input
                            ref={inputRef}
                            type="text"
                            value={inputValue}
                            onChange={e => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="input"
                            placeholder={inputPlaceholder}
                        />
                    </div>
                )}
                <div className="flex gap-3">
                    <button type="button" onClick={onCancel} className="btn-secondary flex-1">{cancelText}</button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        className={`flex-1 px-4 py-2.5 rounded-xl font-medium transition-all ${btnColors[confirmColor] || btnColors.primary}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
