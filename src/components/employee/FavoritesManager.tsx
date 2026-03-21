import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getFavorites, createFavorite, deleteFavorite } from '../../lib/firestore';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from '../../contexts/ConfirmContext';

interface Favorite {
    id: string;
    name: string;
    address?: string;
    userId: string;
    organizationId?: string;
}

export default function FavoritesManager() {
    const { user, userData } = useAuth();
    const [favorites, setFavorites] = useState<Favorite[]>([]);
    const [loading, setLoading] = useState(true);
    const [newName, setNewName] = useState('');
    const [newAddress, setNewAddress] = useState('');
    const [adding, setAdding] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const { showToast } = useToast();
    const { confirm } = useConfirm();

    /* eslint-disable react-hooks/exhaustive-deps */
    useEffect(() => {
        if (!user?.uid) return;
        loadFavorites();
    }, [user?.uid]);
    /* eslint-enable react-hooks/exhaustive-deps */

    const loadFavorites = async () => {
        try {
            const data = await getFavorites(user!.uid);
            setFavorites(data as Favorite[]);
        } catch (err) {
            console.error('즐겨찾기 로드 실패:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newName.trim()) return;
        setAdding(true);
        try {
            await createFavorite({
                userId: user!.uid,
                name: newName.trim(),
                address: newAddress.trim(),
                organizationId: userData?.organizationId,
            });
            setNewName('');
            setNewAddress('');
            setShowForm(false);
            await loadFavorites();
        } catch (err) {
            console.error('즐겨찾기 추가 실패:', err);
            showToast('추가에 실패했습니다.', 'error');
        } finally {
            setAdding(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!await confirm({ message: '이 즐겨찾기를 삭제하시겠습니까?', confirmColor: 'danger' })) return;
        try {
            await deleteFavorite(id);
            setFavorites(prev => prev.filter(f => f.id !== id));
        } catch (err) {
            console.error('즐겨찾기 삭제 실패:', err);
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
                    <h1 className="text-lg font-bold text-surface-900 dark:text-surface-100">목적지 즐겨찾기</h1>
                    <p className="text-sm text-surface-500 dark:text-surface-400">자주 가는 목적지를 관리합니다</p>
                </div>
                <button
                    onClick={() => setShowForm(!showForm)}
                    className="btn-primary text-sm !py-2 !px-3"
                >
                    {showForm ? '취소' : '+ 추가'}
                </button>
            </div>

            {showForm && (
                <form onSubmit={handleAdd} className="glass-card p-4 mb-4 space-y-3 animate-fade-in">
                    <div>
                        <label className="label">이름 (별칭) <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            className="input"
                            placeholder="예: 김OO 어르신 댁"
                            required
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="label">주소</label>
                        <input
                            type="text"
                            value={newAddress}
                            onChange={e => setNewAddress(e.target.value)}
                            className="input"
                            placeholder="예: 서울시 강남구 테헤란로 123"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={adding || !newName.trim()}
                        className="btn-primary w-full text-sm"
                    >
                        {adding ? '추가 중...' : '즐겨찾기 추가'}
                    </button>
                </form>
            )}

            {favorites.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <div className="text-4xl mb-3">⭐</div>
                    <p className="text-surface-400 font-medium">등록된 즐겨찾기가 없습니다</p>
                    <p className="text-xs text-surface-300 mt-1">자주 가는 목적지를 추가해보세요</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {favorites.map(fav => (
                        <div key={fav.id} className="glass-card p-4 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center text-lg flex-shrink-0">
                                ⭐
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm text-surface-900 dark:text-surface-100 truncate">{fav.name}</p>
                                {fav.address && (
                                    <p className="text-xs text-surface-400 truncate">{fav.address}</p>
                                )}
                            </div>
                            <button
                                onClick={() => handleDelete(fav.id)}
                                className="btn-icon text-surface-300 hover:text-red-500 flex-shrink-0"
                                title="삭제"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
