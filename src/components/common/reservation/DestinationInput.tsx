/**
 * DestinationInput - 목적지 입력 + POI 드롭다운 + 즐겨찾기 + 최근 목적지
 */
import React, { useRef, useEffect } from 'react';
import { parseDestinations } from '../../../lib/tmap';
import { usePoiSearch } from '../../../hooks/usePoiSearch';
import type { Favorite } from '../../../types/favorite';
import type { ReservationForm } from '../../../types/reservation';

interface DestinationInputProps {
    form: ReservationForm;
    setForm: React.Dispatch<React.SetStateAction<ReservationForm>>;
    destinationRef: React.RefObject<HTMLInputElement | null>;
    favorites: Favorite[];
    recentDestinations: string[];
    showFavSave: boolean;
    setShowFavSave: (show: boolean) => void;
    favName: string;
    setFavName: (name: string) => void;
    onSaveFavorite: () => Promise<void>;
}

export default function DestinationInput({
    form,
    setForm,
    destinationRef,
    favorites,
    recentDestinations,
    showFavSave,
    setShowFavSave,
    favName,
    setFavName,
    onSaveFavorite,
}: DestinationInputProps) {
    const dropdownRef = useRef<HTMLDivElement>(null);
    const { poiResults, poiLoading, showPoiDropdown, setShowPoiDropdown, clearPoiResults, suppressNext } =
        usePoiSearch(form.destination);

    // 드롭다운 외부 클릭 시 닫기
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(e.target as Node) &&
                destinationRef.current &&
                !destinationRef.current.contains(e.target as Node)
            ) {
                setShowPoiDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [destinationRef, setShowPoiDropdown]);

    const handleSelectPoi = (name: string, address: string) => {
        // "서울 강남구 테헤란로" 처럼 주소가 있으면 "이름 (주소)" 형태로 저장
        const destination = address ? `${name} (${address})` : name;
        suppressNext(); // 선택으로 인한 keyword 변경 시 재검색 방지
        setForm({ ...form, destination });
        clearPoiResults();
    };

    return (
        <>
            <label className="label text-sm font-medium">📍 목적지 <span className="text-red-500">*</span></label>
            <div className="relative mt-1">
                <div className="flex items-center gap-1.5">
                    <input
                        ref={destinationRef}
                        type="text"
                        value={form.destination}
                        onChange={e => {
                            setForm({ ...form, destination: e.target.value });
                            // 입력 변경 시 드롭다운 닫지 않음 (usePoiSearch가 자동으로 재검색)
                        }}
                        onFocus={() => {
                            if (poiResults.length > 0) setShowPoiDropdown(true);
                        }}
                        className="input flex-1 text-sm"
                        placeholder="예: 부산 영인모터스, 강남역 (쉼표로 여러 곳)"
                        required
                        autoComplete="off"
                    />
                    {/* 즐겨찾기 저장 아이콘 버튼 */}
                    {form.destination.trim() && parseDestinations(form.destination).length <= 1 && !favorites.some(f => f.address === form.destination.trim() || f.name === form.destination.trim()) && (
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

                {/* POI 검색 드롭다운 */}
                {(showPoiDropdown || poiLoading) && (
                    <div
                        ref={dropdownRef}
                        className="absolute z-50 left-0 right-0 top-full mt-1 rounded-xl border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 shadow-xl overflow-hidden animate-fade-in"
                    >
                        {poiLoading && (
                            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-surface-400 dark:text-surface-500">
                                <span className="inline-block w-3 h-3 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
                                장소 검색 중...
                            </div>
                        )}
                        {!poiLoading && poiResults.map((poi, i) => (
                            <button
                                key={`poi-${i}-${poi.name}`}
                                type="button"
                                onMouseDown={e => {
                                    e.preventDefault(); // onBlur보다 먼저 실행되도록
                                    handleSelectPoi(poi.name, poi.address);
                                }}
                                className="w-full text-left px-3 py-2.5 flex items-start gap-2.5 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors border-b border-surface-100 dark:border-surface-700 last:border-0"
                            >
                                <span className="mt-0.5 text-primary-500 text-sm flex-shrink-0">📍</span>
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
                                        {poi.name}
                                    </p>
                                    {poi.address && (
                                        <p className="text-xs text-surface-400 dark:text-surface-500 truncate mt-0.5">
                                            {poi.address}
                                        </p>
                                    )}
                                </div>
                            </button>
                        ))}
                        {!poiLoading && poiResults.length === 0 && showPoiDropdown && (
                            <div className="px-3 py-2.5 text-xs text-surface-400 dark:text-surface-500">
                                검색 결과가 없습니다.
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* 즐겨찾기 저장 폼 */}
            {showFavSave && (
                <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800/40 animate-fade-in">
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={favName}
                            onChange={e => setFavName(e.target.value)}
                            className="input flex-1 text-xs py-1.5"
                            placeholder="별칭 (예: 김OO 어르신 댁)"
                        />
                        <button
                            type="button"
                            onClick={onSaveFavorite}
                            className="btn-primary text-xs !py-1.5 !px-2.5 whitespace-nowrap"
                        >
                            저장
                        </button>
                    </div>
                </div>
            )}
            {/* 퀵 선택 (즐겨찾기 + 최근 목적지) 칩 */}
            {(favorites.length > 0 || recentDestinations.length > 0) && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                    {/* 즐겨찾기 */}
                    {favorites.map(fav => (
                        <button
                            key={`fav-${fav.id}`}
                            type="button"
                            onClick={() => {
                                suppressNext();
                                setForm({ ...form, destination: fav.address || fav.name });
                                clearPoiResults();
                            }}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1 shrink-0 ${form.destination === (fav.address || fav.name)
                                ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-300'
                                : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-amber-300 hover:bg-amber-50 dark:hover:border-amber-700 dark:hover:bg-amber-900/20'
                                }`}
                        >
                            <span className="text-[10px]">⭐</span>
                            {fav.name}
                        </button>
                    ))}
                    {/* 구분선 (둘 다 있을 경우) */}
                    {favorites.length > 0 && recentDestinations.length > 0 && (
                        <div className="w-[1px] h-5 bg-surface-200 dark:bg-surface-700 mx-1 self-center" />
                    )}
                    {/* 최근 목적지 */}
                    {recentDestinations.filter(dest => !favorites.some(f => (f.address || f.name) === dest)).map(dest => (
                        <button
                            key={`recent-${dest}`}
                            type="button"
                            onClick={() => {
                                suppressNext();
                                setForm({ ...form, destination: dest });
                                clearPoiResults();
                            }}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1 shrink-0 ${form.destination === dest
                                ? 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300'
                                : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-blue-300 hover:bg-blue-50 dark:hover:border-blue-700 dark:hover:bg-blue-900/20'
                                }`}
                        >
                            <span className="text-[10px] opacity-70">🕒</span>
                            {dest}
                        </button>
                    ))}
                </div>
            )}
        </>
    );
}
