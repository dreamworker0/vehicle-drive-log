/**
 * actions/favoriteActions.ts
 * 즐겨찾기 저장 (handleSaveFavorite)
 */
import { getFavorites, createFavorite } from '../../../lib/firestore';
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
    } catch {
        showToast('즐겨찾기 저장에 실패했습니다.', 'error');
        return;
    }
    // 저장은 끝났다 — 여기서부터의 실패는 "저장 실패"가 아니다. 예전에는 목록 재조회까지 한 try에
    // 묶여 있어, 재조회만 실패해도 "저장 실패"를 띄우고 창을 열어 둬 다시 누르면 중복 저장됐다.
    showToast('즐겨찾기에 저장되었습니다.');
    setShowFavSave(false);
    setFavName('');
    try {
        setFavorites(await getFavorites(user.uid));
    } catch {
        // 목록은 다음에 화면을 열 때 다시 읽는다 — 저장된 사실은 이미 알렸으니 따로 알리지 않는다
    }
}
