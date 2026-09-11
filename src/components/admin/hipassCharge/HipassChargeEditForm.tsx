/**
 * HipassChargeEditForm — 관리자용 하이패스 충전 기록 정정 폼
 *
 * 주유 기록 정정 폼(FuelLogEditForm)과 같은 자리지만 고칠 수 있는 값이 더 적다.
 * 카드·충전자·충전 전 잔액은 그 시점의 사실이라 바꾸지 않고, 날짜와 충전금액만 고친다.
 * 금액을 고치면 카드 잔액도 함께 조정되므로 그 사실을 폼에서 미리 알린다
 * (실제 차액은 저장 시 확인창이 숫자로 보여 준다).
 */
import { memo, useEffect, useRef } from 'react';
import type { HipassCharge } from '../../../types/hipassCharge';
import type { HipassChargeEditForm as FormData } from '../../../hooks/useHipassChargeAdmin';
import { stripNegative } from '../../../hooks/utils/numberValidation';

interface Props {
    record: HipassCharge;
    form: FormData;
    setForm: React.Dispatch<React.SetStateAction<FormData>>;
    saving: boolean;
    onSubmit: (e: React.FormEvent) => void;
    onCancel: () => void;
}

export default memo(function HipassChargeEditForm({
    record, form, setForm, saving, onSubmit, onCancel,
}: Props) {
    // 주유 폼과 같은 이유 — 목록 아래쪽에서 수정을 눌러도 폼이 보이도록 옮겨 준다.
    const formRef = useRef<HTMLFormElement>(null);
    useEffect(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [record.id]);

    return (
        <form ref={formRef} onSubmit={onSubmit} className="glass-card p-5 mb-6 space-y-4 animate-fade-in border-l-4 border-primary-400">
            <div>
                <h2 className="font-semibold text-surface-800 dark:text-surface-200">충전 기록 수정</h2>
                <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
                    {record.chargerName || '직원'}님이 등록한 {record.cardNumber} 기록입니다.
                    충전자·카드는 바뀌지 않으며, 수정하면 목록에 '관리자 수정' 표시가 남습니다.
                </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="label">날짜 <span className="text-red-500 dark:text-red-400">*</span></label>
                    <input
                        type="date"
                        value={form.date}
                        onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))}
                        className="input min-h-[48px]"
                        required
                    />
                </div>
                <div>
                    <label className="label">충전금액 (원) <span className="text-red-500 dark:text-red-400">*</span></label>
                    <input
                        type="number"
                        min="0"
                        value={form.chargeAmount}
                        onChange={e => setForm(prev => ({ ...prev, chargeAmount: stripNegative(e.target.value) }))}
                        className="input min-h-[48px]"
                        placeholder="50000"
                        required
                    />
                </div>
            </div>

            <p className="text-xs text-surface-500 dark:text-surface-400 bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
                💳 충전 전 잔액 {(record.balanceBefore || 0).toLocaleString()}원은 그대로 두고,
                충전 후 잔액은 새 금액에 맞춰 다시 계산됩니다.
                <br />
                금액을 고치면 <strong className="font-semibold">카드의 현재 잔액도 차액만큼 함께 조정</strong>됩니다.
            </p>

            <div className="flex justify-end gap-2">
                <button type="button" onClick={onCancel} className="btn-secondary min-h-[48px]">취소</button>
                <button type="submit" disabled={saving} className="btn-primary min-h-[48px]">
                    {saving ? '저장 중...' : '수정 완료'}
                </button>
            </div>
        </form>
    );
});
