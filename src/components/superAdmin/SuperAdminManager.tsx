import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from '../../contexts/ConfirmContext';
import { getSuperAdmins, addSuperAdmin, removeSuperAdmin } from '../../lib/firestore';

interface SuperAdmin {
    id: string;
    name?: string;
    email?: string;
}

export default function SuperAdminManager() {
    const { user } = useAuth();
    const { showToast } = useToast();
    const { confirm } = useConfirm();
    const [admins, setAdmins] = useState<SuperAdmin[]>([]);
    const [loading, setLoading] = useState(true);
    const [email, setEmail] = useState('');
    const [adding, setAdding] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const list = await getSuperAdmins() as SuperAdmin[];
            setAdmins(list);
        } catch (e: any) {
            showToast('목록을 불러오지 못했습니다: ' + e.message, 'error');
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => { load(); }, [load]);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.trim()) return;
        setAdding(true);
        try {
            await addSuperAdmin(email.trim().toLowerCase());
            showToast(`${email} 을(를) 슈퍼관리자로 추가했습니다.`, 'success');
            setEmail('');
            await load();
        } catch (err: any) {
            showToast(err.message, 'error');
        } finally {
            setAdding(false);
        }
    };

    const handleRemove = async (admin: SuperAdmin) => {
        if (admin.id === user?.uid) {
            showToast('본인은 제거할 수 없습니다.', 'error');
            return;
        }
        if (!await confirm({ message: `${admin.name || admin.email} 을(를) 슈퍼관리자에서 제거하시겠습니까?`, confirmColor: 'danger' })) return;
        try {
            await removeSuperAdmin(admin.id, admins.length);
            showToast('슈퍼관리자에서 제거했습니다.', 'success');
            await load();
        } catch (err: any) {
            showToast(err.message, 'error');
        }
    };

    return (
        <div className="animate-fade-in">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-surface-100">슈퍼관리자 관리</h1>
                <p className="text-surface-500 dark:text-surface-400 text-sm mt-1">슈퍼관리자 계정을 추가하거나 제거합니다.</p>
            </div>

            {/* 추가 폼 */}
            <div className="glass-card p-5 mb-6">
                <h2 className="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-3">새 슈퍼관리자 추가</h2>
                <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
                    ⚠️ 추가할 계정이 먼저 앱에 <strong>Google 로그인</strong>을 한 번 해야 합니다.
                </p>
                <form onSubmit={handleAdd} className="flex gap-2">
                    <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="이메일 주소 입력"
                        className="flex-1 input text-sm"
                        disabled={adding}
                        required
                    />
                    <button
                        type="submit"
                        disabled={adding || !email.trim()}
                        className="btn-primary px-4 py-2 text-sm whitespace-nowrap disabled:opacity-50"
                    >
                        {adding ? '추가 중...' : '추가'}
                    </button>
                </form>
            </div>

            {/* 목록 */}
            <div className="glass-card divide-y divide-surface-100 dark:divide-surface-700">
                <div className="px-4 py-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-surface-700 dark:text-surface-300">슈퍼관리자 목록</span>
                    <span className="text-xs text-surface-400">{admins.length}명</span>
                </div>

                {loading ? (
                    <div className="p-8 text-center text-surface-400 text-sm">불러오는 중...</div>
                ) : admins.length === 0 ? (
                    <div className="p-8 text-center text-surface-400 text-sm">슈퍼관리자가 없습니다.</div>
                ) : (
                    admins.map(admin => (
                        <div key={admin.id} className="px-4 py-4 flex items-center gap-3">
                            <div className="w-9 h-9 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
                                <span className="text-amber-600 text-sm font-bold">⚡</span>
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">
                                    {admin.name || '이름 없음'}
                                    {admin.id === user?.uid && (
                                        <span className="ml-1.5 text-xs text-primary-500 font-normal">(나)</span>
                                    )}
                                </p>
                                <p className="text-xs text-surface-500 dark:text-surface-400 truncate">{admin.email}</p>
                            </div>
                            {admin.id !== user?.uid && (
                                <button
                                    onClick={() => handleRemove(admin)}
                                    className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors flex-shrink-0"
                                >
                                    제거
                                </button>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
