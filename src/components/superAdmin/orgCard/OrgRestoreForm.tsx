/**
 * OrgRestoreForm — 삭제된 계정 복원 섹션
 */
import { memo, useState } from 'react';

interface Props {
    orgId: string;
    onRestoreUser: (email: string, orgId: string, name: string) => Promise<void>;
}

export default memo(function OrgRestoreForm({ orgId, onRestoreUser }: Props) {
    const [showRestore, setShowRestore] = useState(false);
    const [form, setForm] = useState({ email: '', name: '' });
    const [restoring, setRestoring] = useState(false);

    if (!showRestore) {
        return (
            <button
                onClick={() => setShowRestore(true)}
                className="flex items-center gap-2 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 19.644l3.181-3.18" />
                </svg>
                삭제된 계정 복원
            </button>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-surface-700 dark:text-surface-300 flex items-center gap-1.5">
                    <svg className="w-4 h-4 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 19.644l3.181-3.18" />
                    </svg>
                    계정 복원
                </h4>
                <button
                    onClick={() => { setShowRestore(false); setForm({ email: '', name: '' }); }}
                    className="text-xs text-surface-400 dark:text-surface-500 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
                >
                    닫기
                </button>
            </div>
            <p className="text-xs text-surface-400 dark:text-surface-500">
                삭제(비활성화)된 직원의 이메일을 입력하면 계정을 복원합니다.
            </p>
            <div className="flex gap-2">
                <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                    className="input text-sm flex-[1]"
                    placeholder="이름"
                />
                <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                    className="input text-sm flex-[2]"
                    placeholder="이메일"
                />
                <button
                    onClick={async () => {
                        if (!form.email.trim()) return;
                        setRestoring(true);
                        try {
                            await onRestoreUser(form.email.trim(), orgId, form.name.trim());
                            setForm({ email: '', name: '' });
                            setShowRestore(false);
                        } catch (err) {
                            console.error('계정 복원 중 에러:', err);
                        } finally {
                            setRestoring(false);
                        }
                    }}
                    disabled={restoring || !form.email.trim()}
                    className="btn-primary btn-sm text-xs whitespace-nowrap"
                >
                    {restoring ? <><div className="w-3 h-3 spinner" />복원 중...</> : '복원'}
                </button>
            </div>
        </div>
    );
});
