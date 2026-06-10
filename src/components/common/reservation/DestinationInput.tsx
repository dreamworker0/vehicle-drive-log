/**
 * DestinationInput - 목적지 입력 + POI 드롭다운 + 즐겨찾기 + 최근 목적지 (태그 입력기 UX)
 */
import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { parseDestinations } from '../../../lib/tmap';
import { usePoiSearch } from '../../../hooks/usePoiSearch';
import type { Favorite } from '../../../types/favorite';
import type { ReservationForm } from '../../../types/reservation';

interface DestinationInputProps {
    form: ReservationForm;
    setForm: React.Dispatch<React.SetStateAction<ReservationForm>>;
    favorites: Favorite[];
    recentDestinations: string[];
    showFavSave: boolean;
    setShowFavSave: (show: boolean) => void;
    favName: string;
    setFavName: (name: string) => void;
    onSaveFavorite: () => Promise<void>;
}

const DestinationInput = forwardRef<HTMLInputElement, DestinationInputProps>(
    function DestinationInput(
        {
            form,
            setForm,
            favorites,
            recentDestinations,
            showFavSave,
            setShowFavSave,
            favName,
            setFavName,
            onSaveFavorite,
        },
        ref
    ) {
        const dropdownRef = useRef<HTMLDivElement>(null);
        const internalInputRef = useRef<HTMLInputElement | null>(null);
        const [inputValue, setInputValue] = useState('');
        const [inputError, setInputError] = useState('');

        // 실시간 타이핑 중인 inputValue로 POI 드롭다운 검색 수행
        const { poiResults, poiLoading, showPoiDropdown, setShowPoiDropdown, clearPoiResults, suppressNext } =
            usePoiSearch(inputValue);

        // form.destination 전체 문자열에서 쉼표 기준으로 확정된 목적지 목록 파싱
        const destinationList = parseDestinations(form.destination);

        // 부모 컴포넌트가 ref.current를 호출하면 내부 실제 input 인스턴스를 정상 반환하도록 노출
        useImperativeHandle(ref, () => internalInputRef.current as HTMLInputElement);

        // 드롭다운 외부 클릭 시 닫기
        useEffect(() => {
            const handleClickOutside = (e: MouseEvent) => {
                if (
                    dropdownRef.current &&
                    !dropdownRef.current.contains(e.target as Node) &&
                    internalInputRef.current &&
                    !internalInputRef.current.contains(e.target as Node)
                ) {
                    setShowPoiDropdown(false);
                }
            };
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }, [setShowPoiDropdown]);

        // 목적지 목록에 새로운 목적지 추가
        const handleAddDestination = (newDest: string) => {
            const trimmed = newDest.trim();
            if (!trimmed) return;

            // 이미 등록된 목적지 중복 체크
            if (destinationList.includes(trimmed)) {
                setInputValue('');
                clearPoiResults();
                setInputError('');
                return;
            }

            // 최대 5개 등록 제한
            if (destinationList.length >= 5) {
                setInputError('목적지는 최대 5개까지만 등록할 수 있습니다.');
                return;
            }

            const newList = [...destinationList, trimmed];
            suppressNext();
            setForm(prev => ({ ...prev, destination: newList.join(', ') }));
            setInputValue('');
            clearPoiResults();
            setInputError('');
        };

        // 목적지 목록에서 특정 인덱스의 목적지 삭제
        const handleRemoveDestination = (index: number) => {
            const newList = destinationList.filter((_, i) => i !== index);
            suppressNext();
            setForm(prev => ({ ...prev, destination: newList.join(', ') }));
            setInputError('');
        };

        const handleSelectPoi = (name: string, address: string) => {
            // "서울 강남구 테헤란로" 처럼 주소가 있으면 "이름 (주소)" 형태로 저장
            const destination = address ? `${name} (${address})` : name;
            handleAddDestination(destination);
        };

        // 키보드 단축 로직 핸들러
        const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (showPoiDropdown && poiResults.length > 0) {
                    // 검색 결과가 있으면 첫 번째 항목 선택
                    const firstPoi = poiResults[0];
                    handleSelectPoi(firstPoi.name, firstPoi.address);
                } else if (inputValue.trim()) {
                    // 검색 결과가 없는 일반 타이핑 값 바로 추가
                    handleAddDestination(inputValue);
                }
            } else if (e.key === 'Backspace' && !inputValue && destinationList.length > 0) {
                // 입력창이 비어있는 상태에서 백스페이스 시 마지막 목적지 삭제
                handleRemoveDestination(destinationList.length - 1);
            }
        };

        return (
            <>
                <label className="label text-sm font-medium">📍 목적지 <span className="text-red-500 dark:text-red-400">*</span></label>
                <div className="relative mt-1">
                    {/* 태그 입력창 컨테이너 */}
                    <div
                        onClick={() => internalInputRef.current?.focus()}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') internalInputRef.current?.focus(); }}
                        className="input flex flex-wrap items-center gap-1.5 p-1.5 min-h-[42px] cursor-text focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500 flex-1 w-full bg-white dark:bg-surface-800"
                    >
                        {/* 확정된 목적지 칩 리스트 */}
                        {destinationList.map((dest, idx) => (
                            <div
                                key={`dest-chip-${idx}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary-50 border border-primary-100 text-primary-800 dark:bg-primary-950/40 dark:border-primary-900/60 dark:text-primary-300 text-xs font-medium shrink-0 animate-scale-in"
                            >
                                <span className="text-[10px] select-none">📍</span>
                                <span className="max-w-[150px] truncate select-none">{dest}</span>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveDestination(idx);
                                    }}
                                    className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-primary-400 dark:text-primary-500 hover:text-primary-600 dark:hover:text-primary-200 hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors ml-0.5"
                                    title="목적지 삭제"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}

                        {/* 실시간 입력 인풋 */}
                        {destinationList.length < 5 ? (
                            <input
                                ref={internalInputRef}
                                type="text"
                                value={inputValue}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    // 쉼표(,) 입력 시 앞단어를 칩으로 즉시 파싱 등록
                                    if (val.includes(',')) {
                                        const parts = val.split(',');
                                        const toAdd = parts[0].trim();
                                        if (toAdd) {
                                            handleAddDestination(toAdd);
                                        }
                                        setInputValue(parts.slice(1).join(','));
                                    } else {
                                        setInputValue(val);
                                    }
                                    setInputError('');
                                }}
                                onKeyDown={handleKeyDown}
                                onFocus={() => {
                                    if (poiResults.length > 0) setShowPoiDropdown(true);
                                }}
                                className="flex-1 bg-transparent border-0 outline-none p-0 text-sm focus:ring-0 focus:ring-offset-0 min-w-[100px] dark:text-surface-100"
                                placeholder={destinationList.length === 0 ? '장소 검색 또는 직접 입력 후 Enter (최대 5개)' : '추가 목적지 입력...'}
                                required={destinationList.length === 0}
                                autoComplete="off"
                            />
                        ) : (
                            <span className="text-xs text-surface-400 dark:text-surface-500 py-1 pl-1 font-medium select-none">
                                목적지 최대 개수(5개) 도달
                            </span>
                        )}

                        {/* 즐겨찾기 저장 아이콘 버튼 */}
                        {inputValue.trim() && destinationList.length <= 1 && !favorites.some(f => f.address === inputValue.trim() || f.name === inputValue.trim()) && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowFavSave(!showFavSave);
                                }}
                                className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all ml-auto ${showFavSave
                                    ? 'bg-amber-100 text-amber-600 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700'
                                    : 'bg-surface-100 text-amber-500 border border-surface-200 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-600 dark:bg-surface-700 dark:border-surface-600 dark:text-amber-400 dark:hover:bg-amber-900/30'
                                    }`}
                                title="즐겨찾기에 저장"
                            >
                                {showFavSave ? '⭐' : '☆'}
                            </button>
                        )}
                    </div>

                    {/* 입력 제약 경고 텍스트 */}
                    {inputError && (
                        <p className="text-xs text-red-500 dark:text-red-400 mt-1 pl-1 animate-slide-down font-medium">
                            ⚠️ {inputError}
                        </p>
                    )}

                    {/* POI 검색 결과 드롭다운 */}
                    {(showPoiDropdown || poiLoading) && (
                        <div
                            ref={dropdownRef}
                            className="absolute z-50 left-0 right-0 top-full mt-1 rounded-xl border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 shadow-xl max-h-[280px] overflow-y-auto scrollbar-thin scrollbar-thumb-surface-200 dark:scrollbar-thumb-surface-700 animate-fade-in"
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
                                    <span className="mt-0.5 text-primary-500 dark:text-primary-400 text-sm flex-shrink-0">📍</span>
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

                {/* 퀵 선택 (즐겨찾기 + 최근 목적지) 칩 목록 */}
                {(favorites.length > 0 || recentDestinations.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        {/* 즐겨찾기 */}
                        {favorites.map(fav => {
                            const targetAddr = fav.address || fav.name;
                            const isSelected = destinationList.includes(targetAddr);
                            return (
                                <button
                                    key={`fav-${fav.id}`}
                                    type="button"
                                    onClick={() => {
                                        if (isSelected) {
                                            handleRemoveDestination(destinationList.indexOf(targetAddr));
                                        } else {
                                            handleAddDestination(targetAddr);
                                        }
                                    }}
                                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1 shrink-0 ${isSelected
                                        ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-300'
                                        : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-amber-300 hover:bg-amber-50 dark:hover:border-amber-700 dark:hover:bg-amber-900/20'
                                        }`}
                                >
                                    <span className="text-[10px]">⭐</span>
                                    {fav.name}
                                </button>
                            );
                        })}

                        {/* 구분선 (둘 다 있을 경우) */}
                        {favorites.length > 0 && recentDestinations.length > 0 && (
                            <div className="w-[1px] h-5 bg-surface-200 dark:bg-surface-700 mx-1 self-center" />
                        )}

                        {/* 최근 목적지 */}
                        {recentDestinations.filter(dest => !favorites.some(f => (f.address || f.name) === dest)).map(dest => {
                            const isSelected = destinationList.includes(dest);
                            return (
                                <button
                                    key={`recent-${dest}`}
                                    type="button"
                                    onClick={() => {
                                        if (isSelected) {
                                            handleRemoveDestination(destinationList.indexOf(dest));
                                        } else {
                                            handleAddDestination(dest);
                                        }
                                    }}
                                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1 shrink-0 ${isSelected
                                        ? 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/40 dark:border-blue-700 dark:text-blue-300'
                                        : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-blue-300 hover:bg-blue-50 dark:hover:border-blue-700 dark:hover:bg-blue-900/20'
                                        }`}
                                >
                                    <span className="text-[10px] opacity-70">🕒</span>
                                    {dest}
                                </button>
                            );
                        })}
                    </div>
                )}
            </>
        );
    }
);

export default DestinationInput;
