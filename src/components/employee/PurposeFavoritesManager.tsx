import React, { useState } from 'react';
import { useFavoritePurposes } from '../../hooks/useFavoritePurposes';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from '../../hooks/useConfirm';
import { captureError } from '../../lib/sentry';
import { MAX_FAVORITE_PURPOSES, MAX_FAVORITE_PURPOSE_LENGTH } from '../../lib/firestore';

/**
 * 더보기 › 자주 쓰는 목적
 *
 * 목적지 즐겨찾기(FavoritesManager)와 같은 모양의 관리 화면이다. 여기서 등록한 목적은
 * 운행일지·바로 운행·예약 화면의 목적 칸 아래 단추(PurposeChips)로 뜬다.
 */
export default function PurposeFavoritesManager() {
    const { purposes, loading, add, remove, isFull } = useFavoritePurposes();
    const [newText, setNewText] = useState('');
    const [adding, setAdding] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const { showToast } = useToast();
    const { confirm } = useConfirm();

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newText.trim()) return;
        setAdding(true);
        try {
            const result = await add(newText);
            if (result === 'duplicate') {
                showToast('이미 등록된 목적이에요', 'info');
                return;
            }
            if (result === 'full') {
                showToast(`자주 쓰는 목적은 ${MAX_FAVORITE_PURPOSES}개까지 등록할 수 있어요`, 'error');
                return;
            }
            setNewText('');
            setShowForm(false);
        } catch (err) {
            captureError(err, { context: 'PurposeFavoritesManager.add' });
            showToast('추가에 실패했습니다.', 'error');
        } finally {
            setAdding(false);
        }
    };

    const handleDelete = async (id: string, text: string) => {
        if (!await confirm({ message: `'${text}'을(를) 자주 쓰는 목적에서 지울까요?`, confirmColor: 'danger' })) return;
        try {
            await remove(id);
        } catch (err) {
            captureError(err, { context: 'PurposeFavoritesManager.delete' });
            showToast('삭제에 실패했습니다.', 'error');
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 spinner" />
            </div>
        );
    }

    return (
        <div className="max-w-lg mx-auto animate-fade-in">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h1 className="text-lg font-bold text-surface-900 dark:text-surface-100">자주 쓰는 목적</h1>
                    <p className="text-sm text-surface-500 dark:text-surface-400">운행 목적 칸 아래에 단추로 떠요</p>
                </div>
                {!isFull && (
                    <button
                        onClick={() => setShowForm(!showForm)}
                        className="btn-primary text-sm !py-2 !px-3 min-h-[48px]"
                    >
                        {showForm ? '취소' : '+ 추가'}
                    </button>
                )}
            </div>

            {showForm && (
                <form onSubmit={handleAdd} className="glass-card p-4 mb-4 space-y-3 animate-fade-in">
                    <div>
                        <label htmlFor="new-purpose" className="label">운행 목적 <span className="text-red-500 dark:text-red-400">*</span></label>
                        <input
                            id="new-purpose"
                            type="text"
                            value={newText}
                            onChange={e => setNewText(e.target.value)}
                            className="input min-h-[48px]"
                            placeholder="예: 가정방문, 병원 동행, 물품 구매"
                            maxLength={MAX_FAVORITE_PURPOSE_LENGTH}
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={adding || !newText.trim()}
                        className="btn-primary w-full text-sm min-h-[48px]"
                    >
                        {adding ? '추가 중...' : '목적 추가'}
                    </button>
                </form>
            )}

            {purposes.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">📝</div>
                    <p className="text-surface-500 dark:text-surface-400 font-medium">등록된 목적이 없습니다</p>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">자주 적는 운행 목적을 추가해 보세요</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {purposes.map(p => (
                        <div key={p.id} className="glass-card p-4 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center text-lg flex-shrink-0">
                                📝
                            </div>
                            <p className="flex-1 min-w-0 font-medium text-sm text-surface-900 dark:text-surface-100 truncate">{p.text}</p>
                            <button
                                onClick={() => handleDelete(p.id, p.text)}
                                className="btn-icon text-surface-500 dark:text-surface-400 hover:text-red-500 dark:hover:text-red-400 min-w-[48px] min-h-[48px] flex items-center justify-center flex-shrink-0"
                                title="삭제"
                                aria-label={`${p.text} 삭제`}
                            >
                                <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                </svg>
                            </button>
                        </div>
                    ))}
                    {isFull && (
                        <p className="text-xs text-surface-500 dark:text-surface-400 text-center pt-1">
                            {MAX_FAVORITE_PURPOSES}개까지 등록할 수 있어요. 안 쓰는 목적을 지우면 새로 추가할 수 있어요.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
