/**
 * OrgEditForm — 기관명·주소 인라인 편집 폼
 */
import { memo, useState } from 'react';

interface Props {
    orgId: string;
    initialName: string;
    initialAddress: string;
    onSave: (orgId: string, updates: { name: string; address: string }) => Promise<void>;
    onCancel: () => void;
}

export default memo(function OrgEditForm({ orgId, initialName, initialAddress, onSave, onCancel }: Props) {
    const [form, setForm] = useState({ name: initialName, address: initialAddress });
    const [saving, setSaving] = useState(false);

    const handleSave = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!form.name.trim()) return;
        setSaving(true);
        try {
            await onSave(orgId, {
                name: form.name.trim(),
                address: form.address.trim(),
            });
        } catch {
            // 에러는 부모에서 toast 처리
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        onCancel();
    };

    return (
        <div className="space-y-3" onClick={e => e.stopPropagation()}>
            <div>
                <label className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1 block">기관명 <span className="text-red-500">*</span></label>
                <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                    className="input text-sm"
                    placeholder="기관명"
                    autoFocus
                />
            </div>
            <div>
                <label className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1 block">주소</label>
                <input
                    type="text"
                    value={form.address}
                    onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))}
                    className="input text-sm"
                    placeholder="주소"
                />
            </div>
            <div className="flex gap-2">
                <button
                    onClick={handleSave}
                    disabled={saving || !form.name.trim()}
                    className="btn-primary btn-sm text-xs"
                >
                    {saving ? (<><div className="w-3 h-3 spinner" />저장 중...</>) : '저장'}
                </button>
                <button
                    onClick={handleCancel}
                    disabled={saving}
                    className="btn-ghost btn-sm text-xs"
                >
                    취소
                </button>
            </div>
        </div>
    );
});
