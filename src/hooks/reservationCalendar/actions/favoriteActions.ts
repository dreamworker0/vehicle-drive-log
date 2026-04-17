/**
 * actions/favoriteActions.ts
 * 즐겨찾기 저장 (handleSaveFavorite)
 */
import { getFavorites, createFavorite } from '../../../lib/firestore';
import type { Favorite } from '../../../types/favorite';
import type { SaveFavoriteDeps } from './types';

export async function handleSaveFavorite(deps: SaveFavoriteDeps) {
    const { user, userData, form, favName, showToast, setFavorites, setShowFavSave, setFavName } = deps;
    if (!user || !form.destination.trim()) return;
    try {
        await createFavorite({
            userId: user.uid,
            name: favName || form.destination,
            address: form.destination,
            organizationId: userData?.organizationId || ''
        });
        showToast('즐겨찾기에 저장되었습니다.');
        const fList = await getFavorites(user.uid);
        setFavorites(fList as Favorite[]);
        setShowFavSave(false);
        setFavName('');
    } catch {
        showToast('즐겨찾기 저장에 실패했습니다.', 'error');
    }
}
