import { memo } from 'react';
import type { DriveLogForm, LocationState } from '../../../hooks/driveLogForm/types';
import type { Favorite } from '../../../types/favorite';

interface WaypointSectionProps {
    reservationData: LocationState | null;
    isEditMode: boolean;
    form: DriveLogForm;
    setForm: (f: DriveLogForm) => void;
    favorites: Favorite[];
    showFavSave: boolean;
    setShowFavSave: (show: boolean) => void;
    favName: string;
    setFavName: (name: string) => void;
    handleFavoriteSelect: (fav: Favorite) => void;
    handleSaveFavorite: () => void;
}

const WaypointSection = memo(function WaypointSection({
    reservationData,
    isEditMode,
    form,
    setForm,
    favorites,
    showFavSave,
    setShowFavSave,
    favName,
    setFavName,
    handleFavoriteSelect,
    handleSaveFavorite
}: WaypointSectionProps) {
    // 예약 데이터가 있거나 수정 모드이더라도 운행 목적과 행선지를 직접 입력해야 할 때 표시
    if (reservationData?.vehicleId && !isEditMode) return null;

    return (
        <div className="space-y-4">
            <div>
                <label htmlFor="purpose" className="label">운행 목적</label>
                <input
                    id="purpose"
                    type="text"
                    value={form.purpose}
                    onChange={e => setForm({ ...form, purpose: e.target.value })}
                    className="input"
                    placeholder="출장"
                />
            </div>
            <div>
                <label htmlFor="destination" className="label">행선지</label>
                <div className="flex items-center gap-1.5">
                    <input
                        id="destination"
                        type="text"
                        value={form.destination}
                        onChange={e => setForm({ ...form, destination: e.target.value })}
                        className="input flex-1"
                        placeholder="서울시청"
                    />
                    {/* 즐겨찾기 저장 아이콘 버튼 */}
                    {form.destination.trim() && !favorites.some((f: Favorite) => f.address === form.destination.trim() || f.name === form.destination.trim()) && (
                        <button
                            type="button"
                            onClick={() => setShowFavSave(!showFavSave)}
                            className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all ${showFavSave
                                ? 'bg-amber-100 text-amber-600 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700'
                                : 'bg-surface-100 text-amber-500 border border-surface-200 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-600 dark:bg-surface-700 dark:border-surface-600 dark:text-amber-400 dark:hover:bg-amber-900/30'
                                }`}
                            title="즐겨찾기에 저장"
                        >
                            {showFavSave ? '⭐' : '☆'}
                        </button>
                    )}
                </div>
                {/* 즐겨찾기 저장 폼 */}
                {showFavSave && (
                    <div className="mt-2 p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 animate-fade-in">
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={favName}
                                onChange={e => setFavName(e.target.value)}
                                className="input flex-1 text-sm py-1.5"
                                placeholder="별칭 (예: 김OO 어르신 댁)"
                                aria-label="즐겨찾기 별칭"
                            />
                            <button
                                type="button"
                                onClick={handleSaveFavorite}
                                className="btn-primary btn-sm whitespace-nowrap"
                            >
                                저장
                            </button>
                        </div>
                    </div>
                )}
                {/* 즐겨찾기 칩 */}
                {favorites.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        {favorites.map((fav: Favorite) => (
                            <button
                                key={fav.id}
                                type="button"
                                onClick={() => handleFavoriteSelect(fav)}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${form.destination === (fav.address || fav.name)
                                    ? 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400'
                                    : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-amber-300 hover:bg-amber-50'
                                    }`}
                            >
                                ⭐ {fav.name}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});

export default WaypointSection;
