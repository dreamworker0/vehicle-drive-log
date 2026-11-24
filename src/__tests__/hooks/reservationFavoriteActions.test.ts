/**
 * handleSaveFavorite — 예약 폼의 목적지를 즐겨찾기로 저장
 *
 * 고정하는 계약: 목적지가 비면 저장하지 않는다, 이름을 비우면 목적지를 이름으로 쓴다,
 * 기관 ID를 함께 저장한다, 저장 뒤 목록을 다시 읽고 저장 창을 닫는다, 실패하면 창을 그대로 둔다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SaveFavoriteDeps } from '@/hooks/reservationCalendar/actions/types';
import type { ReservationForm } from '@/types/reservation';

const mockCreateFavorite = vi.fn();
const mockGetFavorites = vi.fn();
vi.mock('@/lib/firestore', () => ({
    createFavorite: (...a: unknown[]) => mockCreateFavorite(...a),
    getFavorites: (...a: unknown[]) => mockGetFavorites(...a),
}));

import { handleSaveFavorite } from '@/hooks/reservationCalendar/actions/favoriteActions';

const FAVORITES = [{ id: 'f1', name: '시청', address: '서울시청', destination: '서울시청' }];

function makeDeps(overrides: Partial<SaveFavoriteDeps> & { destination?: string } = {}) {
    const { destination = '서울시청', ...rest } = overrides;
    const deps: SaveFavoriteDeps = {
        user: { uid: 'u1' },
        userData: { organizationId: 'org1' },
        form: { destination } as unknown as ReservationForm,
        favName: '시청',
        showToast: vi.fn(),
        setFavorites: vi.fn(),
        setShowFavSave: vi.fn(),
        setFavName: vi.fn(),
        ...rest,
    };
    return deps;
}

describe('handleSaveFavorite', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateFavorite.mockResolvedValue('f-new');
        mockGetFavorites.mockResolvedValue(FAVORITES);
    });

    it('사용자·기관 ID와 함께 저장하고 목록을 다시 읽은 뒤 저장 창을 닫는다', async () => {
        const deps = makeDeps();

        await handleSaveFavorite(deps);

        expect(mockCreateFavorite).toHaveBeenCalledWith({
            userId: 'u1', name: '시청', address: '서울시청', organizationId: 'org1',
        });
        expect(deps.showToast).toHaveBeenCalledWith('즐겨찾기에 저장되었습니다.');
        expect(mockGetFavorites).toHaveBeenCalledWith('u1');
        expect(deps.setFavorites).toHaveBeenCalledWith(FAVORITES);
        expect(deps.setShowFavSave).toHaveBeenCalledWith(false);
        expect(deps.setFavName).toHaveBeenCalledWith('');
    });

    it('이름을 비우면 목적지를 이름으로 쓴다', async () => {
        await handleSaveFavorite(makeDeps({ favName: '' }));

        expect(mockCreateFavorite.mock.calls[0][0].name).toBe('서울시청');
    });

    it('기관 정보가 없으면 빈 기관 ID로 저장한다', async () => {
        await handleSaveFavorite(makeDeps({ userData: null }));

        expect(mockCreateFavorite.mock.calls[0][0].organizationId).toBe('');
    });

    it.each(['', '   '])('목적지가 비면(%j) 저장하지 않는다', async (destination) => {
        const deps = makeDeps({ destination });

        await handleSaveFavorite(deps);

        expect(mockCreateFavorite).not.toHaveBeenCalled();
        expect(deps.showToast).not.toHaveBeenCalled();
    });

    it('로그인 정보가 없으면 저장하지 않는다', async () => {
        await handleSaveFavorite(makeDeps({ user: null as unknown as SaveFavoriteDeps['user'] }));

        expect(mockCreateFavorite).not.toHaveBeenCalled();
    });

    it('저장이 실패하면 오류 토스트를 띄우고 창은 그대로 둔다', async () => {
        mockCreateFavorite.mockRejectedValue(new Error('permission-denied'));
        const deps = makeDeps();

        await handleSaveFavorite(deps);

        expect(deps.showToast).toHaveBeenCalledWith('즐겨찾기 저장에 실패했습니다.', 'error');
        expect(deps.setShowFavSave).not.toHaveBeenCalled();
        expect(deps.setFavorites).not.toHaveBeenCalled();
    });

    it('저장은 됐지만 목록 재조회가 실패해도 오류로 알린다 (창은 열린 채)', async () => {
        mockGetFavorites.mockRejectedValue(new Error('offline'));
        const deps = makeDeps();

        await handleSaveFavorite(deps);

        expect(mockCreateFavorite).toHaveBeenCalled();
        expect(deps.showToast).toHaveBeenCalledWith('즐겨찾기에 저장되었습니다.');
        expect(deps.showToast).toHaveBeenLastCalledWith('즐겨찾기 저장에 실패했습니다.', 'error');
        expect(deps.setShowFavSave).not.toHaveBeenCalled();
    });
});
