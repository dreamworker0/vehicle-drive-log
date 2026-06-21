/**
 * OrgInfoSection — Settings의 기관 정보 입력 섹션(표시 전용)
 * 상태(form)와 저장 로직(handleSave)은 부모(useSettings)가 소유하고 props로 전달받는다.
 */
import type { SettingsForm } from '../../../hooks/useSettings';

interface OrgInfoSectionProps {
    form: SettingsForm;
    setForm: React.Dispatch<React.SetStateAction<SettingsForm>>;
    handlePhoneChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleSave: (e?: React.FormEvent | null, overrides?: Partial<SettingsForm>) => void;
    saving: boolean;
    onRequestFeedback: () => void;
}

export default function OrgInfoSection({
    form, setForm, handlePhoneChange, handleSave, saving, onRequestFeedback,
}: OrgInfoSectionProps) {
    return (
        <div className="glass-card p-6 mb-6">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">기관 정보</h2>
            <form onSubmit={handleSave} className="space-y-4">
                <div>
                    <label className="label">기관명</label>
                    <input type="text" value={form.name} className="input opacity-60 cursor-not-allowed min-h-[48px]" disabled />
                </div>
                <div>
                    <label className="label">주소</label>
                    {form.address ? (
                        <input type="text" value={form.address} className="input opacity-60 cursor-not-allowed min-h-[48px]" disabled />
                    ) : (
                        <input
                            type="text"
                            value={form.address}
                            onChange={e => setForm({ ...form, address: e.target.value })}
                            className="input"
                            placeholder="AI가 주소를 읽지 못한 경우 직접 입력해주세요"
                        />
                    )}
                    <p className="text-xs text-surface-400 mt-1">
                        💡 주소를 입력하면 예약 시 목적지까지의 소요 시간, 거리, 톨게이트비가 자동으로 계산됩니다.
                    </p>
                </div>
                <div>
                    <label className="label">관리자 이메일</label>
                    <input type="email" value={form.adminEmail} onChange={e => setForm({ ...form, adminEmail: e.target.value })} className="input" />
                </div>
                <div>
                    <label className="label">전화번호</label>
                    <input type="tel" value={form.phone} onChange={handlePhoneChange} className="input min-h-[48px]" placeholder="010-0000-0000" />
                </div>
                <button
                    type="button"
                    onClick={onRequestFeedback}
                    className="text-xs text-primary-500 dark:text-primary-400 hover:text-primary-600 dark:hover:text-primary-300 flex items-center gap-1 transition-colors min-h-[48px] py-2"
                >
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                    </svg>
                    기관명과 주소 변경은 슈퍼관리자에게 요청하세요.
                </button>
                <div className="flex justify-end">
                    <button type="submit" disabled={saving} className="btn-primary min-h-[48px]">
                        {saving ? (<><div className="w-4 h-4 spinner" />저장 중...</>) : '변경사항 저장'}
                    </button>
                </div>
            </form>
        </div>
    );
}
