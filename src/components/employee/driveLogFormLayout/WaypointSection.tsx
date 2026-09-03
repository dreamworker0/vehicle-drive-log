import { memo, useState } from 'react';
import type { DriveLogForm, LocationState } from '../../../hooks/driveLogForm/types';
import type { Favorite } from '../../../types/favorite';
import { canChooseSite, MAIN_SITE_ID, type OrgSite } from '../../../lib/orgSites';

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
    /** 기관의 출발지 목록(본관 + 분관) */
    orgSites: OrgSite[];
    /** 선택된 차량 — 출발지가 매번 바뀌는 차량에만 선택을 연다 */
    selectedVehicle?: { siteVaries?: boolean } | null;
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
    handleSaveFavorite,
    orgSites,
    selectedVehicle
}: WaypointSectionProps) {
    /**
     * 세운 곳을 사용자가 직접 건드렸는가. 건드리기 전까지는 출발지를 따라가고(대부분 왕복이라
     * 확인만 하고 넘어간다), 한 번 고른 뒤에는 따라가지 않는다 — 편도로 세운 곳을 지정했는데
     * 출발지를 고치다가 조용히 되돌아가면 차량 위치가 틀어진다.
     */
    const [endSiteTouched, setEndSiteTouched] = useState(false);

    // 예약 데이터가 있거나 수정 모드이더라도 운행 목적과 행선지를 직접 입력해야 할 때 표시
    if (reservationData?.vehicleId && !isEditMode) return null;

    // 분관 등록만으로는 열지 않는다 — 분관 기능은 원래 분산되어 있지만 **고정된** 차량을 위한
    // 것이라, 그 기관 운전자에게는 얻는 것 없이 잘못 고를 기회만 생긴다.
    const showSiteSelects = canChooseSite(orgSites, selectedVehicle);
    const startSiteId = form.startSiteId || MAIN_SITE_ID;
    const endSiteId = form.endSiteId || MAIN_SITE_ID;

    const handleStartSiteChange = (value: string) => {
        setForm({
            ...form,
            startSiteId: value,
            ...(endSiteTouched ? {} : { endSiteId: value }),
        });
    };

    const handleEndSiteChange = (value: string) => {
        setEndSiteTouched(true);
        setForm({ ...form, endSiteId: value });
    };

    // 행선지는 즐겨찾기 선택 등 외부 경로로 채워지므로 빈 값을 방어한다 — 렌더 중 trim()이
    // 터지면 폼 전체가 사라져 운행일지를 아예 쓸 수 없게 된다.
    const destination = form.destination || '';

    return (
        <div className="space-y-4">
            <div>
                <label htmlFor="purpose" className="label">운행 목적</label>
                <input
                    id="purpose"
                    type="text"
                    value={form.purpose}
                    onChange={e => setForm({ ...form, purpose: e.target.value })}
                    className="input min-h-[48px]"
                    placeholder="출장"
                />
            </div>
            {/* 출발 → 도착 → 세운 곳. 시간 순서가 그대로 위에서 아래로 읽히게 둔다. */}
            {showSiteSelects && (
                <div>
                    <label htmlFor="startSiteId" className="label">출발지</label>
                    <select
                        id="startSiteId"
                        value={startSiteId}
                        onChange={e => handleStartSiteChange(e.target.value)}
                        className="input min-h-[48px]"
                    >
                        {orgSites.map(site => (
                            <option key={site.id} value={site.id}>{site.name}</option>
                        ))}
                    </select>
                </div>
            )}
            <div>
                <label htmlFor="destination" className="label">행선지</label>
                <div className="flex items-center gap-1.5">
                    <input
                        id="destination"
                        type="text"
                        value={destination}
                        onChange={e => setForm({ ...form, destination: e.target.value })}
                        className="input min-h-[48px] flex-1"
                        placeholder="서울시청"
                    />
                    {/* 즐겨찾기 저장 아이콘 버튼 */}
                    {destination.trim() && !favorites.some((f: Favorite) => f.destination === destination.trim() || f.name === destination.trim()) && (
                        <button
                            type="button"
                            onClick={() => setShowFavSave(!showFavSave)}
                            className={`flex-shrink-0 w-12 h-12 min-w-[48px] min-h-[48px] rounded-lg flex items-center justify-center transition-all ${showFavSave
                                ? 'bg-amber-100 text-amber-600 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700'
                                : 'bg-surface-100 dark:bg-surface-800 text-amber-500 dark:text-amber-400 border border-surface-200 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-600 dark:bg-surface-700 dark:border-surface-600 dark:text-amber-400 dark:hover:bg-amber-900/30'
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
                                className="input flex-1 min-h-[48px] text-sm py-1.5"
                                placeholder="별칭 (예: 김OO 어르신 댁)"
                                aria-label="즐겨찾기 별칭"
                            />
                            <button
                                type="button"
                                onClick={handleSaveFavorite}
                                className="btn-primary btn-sm whitespace-nowrap min-h-[48px]"
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
                                className={`px-3 py-2 min-h-[48px] rounded-full text-xs font-medium border transition-all flex items-center justify-center ${destination === fav.destination
                                    ? 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400'
                                    : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-amber-300 dark:hover:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                    }`}
                            >
                                ⭐ {fav.name}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {showSiteSelects && (
                <div>
                    <label htmlFor="endSiteId" className="label">차를 세운 곳</label>
                    <select
                        id="endSiteId"
                        value={endSiteId}
                        onChange={e => handleEndSiteChange(e.target.value)}
                        className="input min-h-[48px]"
                    >
                        {orgSites.map(site => (
                            <option key={site.id} value={site.id}>{site.name}</option>
                        ))}
                    </select>
                    <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">
                        다음에 이 차를 여기서 찾게 됩니다.
                    </p>
                </div>
            )}
        </div>
    );
});

export default WaypointSection;
