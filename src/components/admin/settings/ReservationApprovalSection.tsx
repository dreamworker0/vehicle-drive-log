/**
 * ReservationApprovalSection — Settings의 "예약 관리자 승인" 토글 섹션(표시 전용)
 * 토글 변경 시 부모의 onChange(=handleSave overrides)로 즉시 저장한다.
 */
import Toggle from '../../common/Toggle';

interface ReservationApprovalSectionProps {
    checked: boolean;
    onChange: (next: boolean) => void;
}

export default function ReservationApprovalSection({ checked, onChange }: ReservationApprovalSectionProps) {
    return (
        <div className="glass-card p-6 mb-6">
            <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">예약 관리자 승인</h2>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <span className={`text-xs font-medium ${!checked ? 'text-surface-400 dark:text-surface-500' : 'text-primary-600 dark:text-primary-400'}`}>
                        {checked ? '사용' : '사용 안함'}
                    </span>
                    <Toggle
                        label="예약 관리자 승인"
                        checked={checked}
                        onChange={onChange}
                    />
                </label>
            </div>
            <p className="text-xs text-surface-400">
                💡 사용 시 직원들의 차량 예약이 즉시 확정되지 않고, 관리자의 승인을 거쳐야 합니다.
            </p>
        </div>
    );
}
