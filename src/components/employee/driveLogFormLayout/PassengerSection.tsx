import { memo, useState, useEffect, useRef } from 'react';
import type { User as UserDoc } from '../../../types/user';

interface PassengerSectionProps {
    /** 기관 설정: 직원 목록 직접 선택 허용(기본 true) */
    allowList?: boolean;
    /** 기관 설정: 검색으로 선택(이름 직접 입력) 허용(기본 true) */
    allowSearch?: boolean;
    /** 기관 설정: 인원 숫자 입력 허용(기본 true) */
    allowCount?: boolean;
    members: UserDoc[];
    selectedPassengers: UserDoc[];
    externalPassengerCount: number;
    externalPassengerNames: string;
    togglePassenger: (user: UserDoc) => void;
    setExternalPassengerCount: (count: number) => void;
    setExternalPassengerNames: (names: string) => void;
}

const PassengerSection = memo(function PassengerSection({
    allowList = true,
    allowSearch = true,
    allowCount = true,
    members,
    selectedPassengers,
    externalPassengerCount,
    externalPassengerNames,
    togglePassenger,
    setExternalPassengerCount,
    setExternalPassengerNames
}: PassengerSectionProps) {
    // 로컬 스토리지에서 이전 상태 불러오기 (기본값: true)
    const [isExpanded, setIsExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('driveLog_passengerExpanded');
            return saved !== null ? JSON.parse(saved) : true;
        } catch {
            return true;
        }
    });

    // 상태 변경 시 로컬 스토리지에 저장
    useEffect(() => {
        localStorage.setItem('driveLog_passengerExpanded', JSON.stringify(isExpanded));
    }, [isExpanded]);

    // 직접 입력창 상태 관리 (기본값: false)
    const [isManualInputExpanded, setIsManualInputExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('driveLog_manualInputExpanded');
            return saved !== null ? JSON.parse(saved) : false;
        } catch {
            return false;
        }
    });

    useEffect(() => {
        localStorage.setItem('driveLog_manualInputExpanded', JSON.stringify(isManualInputExpanded));
    }, [isManualInputExpanded]);

    const inputRef = useRef<HTMLInputElement>(null);
    const [autocompleteState, setAutocompleteState] = useState({
        isOpen: false,
        suggestions: [] as UserDoc[],
        startIndex: 0,
        endIndex: 0,
    });

    const handleManualInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setExternalPassengerNames(val);

        const cursor = e.target.selectionStart || 0;
        const textBeforeCursor = val.slice(0, cursor);
        const lastCommaIndex = textBeforeCursor.lastIndexOf(',');
        const startIndex = lastCommaIndex === -1 ? 0 : lastCommaIndex + 1;
        
        const textAfterCursor = val.slice(cursor);
        const nextCommaIndex = textAfterCursor.indexOf(',');
        const endIndex = nextCommaIndex === -1 ? val.length : cursor + nextCommaIndex;

        const searchTerm = val.slice(startIndex, cursor).trim();

        if (searchTerm.length > 0) {
            const suggestions = members.filter(m => {
                const name = m.name || m.email?.split('@')[0] || '';
                return name.toLowerCase().includes(searchTerm.toLowerCase());
            });
            setAutocompleteState({
                isOpen: suggestions.length > 0,
                suggestions,
                startIndex,
                endIndex
            });
        } else {
            setAutocompleteState(prev => ({ ...prev, isOpen: false }));
        }
    };

    const handleSuggestionClick = (member: UserDoc) => {
        const name = member.name || member.email?.split('@')[0] || '';
        const val = externalPassengerNames;
        const before = val.slice(0, autocompleteState.startIndex);
        const after = val.slice(autocompleteState.endIndex);
        
        let newBefore = before.trim() === '' ? '' : before;
        if (newBefore !== '' && !newBefore.endsWith(',') && !newBefore.endsWith(' ')) {
            newBefore += ', ';
        } else if (newBefore.endsWith(',')) {
            newBefore += ' ';
        }

        let newAfter = after.trim();
        if (newAfter !== '' && !newAfter.startsWith(',')) {
            newAfter = ', ' + newAfter;
        } else if (newAfter === '') {
            newAfter = ', '; // 항상 다음 입력을 위해 쉼표 추가
        }

        const newValue = newBefore + name + newAfter;
        setExternalPassengerNames(newValue);
        setAutocompleteState(prev => ({ ...prev, isOpen: false }));
        
        setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.focus();
            }
        }, 0);
    };

    // 허용된 방식별 가시성
    // - 목록·검색 둘 다 허용 → 현행처럼 접기 토글 제공
    // - 하나만 허용 → 접기 없이 항상 노출
    const bothPickMethods = allowList && allowSearch;
    const showHeaderToggles = bothPickMethods;
    const listVisible = allowList && (bothPickMethods ? isExpanded : true);
    const manualVisible = allowSearch && (bothPickMethods ? isManualInputExpanded : true);
    // 인원 숫자만 유일한 입력이면 '인원', 이름 선택 방식이 함께 있으면 '외부 인원'
    const countLabel = (allowList || allowSearch) ? '외부 인원' : '인원';

    return (
        <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
                <label className="label mb-0">
                    🧑‍🤝‍🧑 동승자
                    {(selectedPassengers.length + externalPassengerCount) > 0 && (
                        <span className="ml-2 text-primary-600 dark:text-primary-400 font-bold">
                            {selectedPassengers.length + externalPassengerCount}명
                        </span>
                    )}
                </label>
                {showHeaderToggles && (
                    <div className="flex items-center gap-2">
                        {!isManualInputExpanded && externalPassengerNames && (
                            <span className="text-xs font-medium text-surface-700 dark:text-surface-300 truncate max-w-[80px] sm:max-w-[150px]">
                                {externalPassengerNames}
                            </span>
                        )}
                        {members.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setIsExpanded(!isExpanded)}
                                className="text-xs px-3 py-2 min-h-[48px] rounded-md bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors flex items-center justify-center font-medium"
                            >
                                {isExpanded ? '직원 목록 닫기 ▲' : '직원 선택 ▼'}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setIsManualInputExpanded(!isManualInputExpanded)}
                            className="text-xs px-3 py-2 min-h-[48px] rounded-md bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors flex items-center justify-center font-medium"
                        >
                            {isManualInputExpanded ? '직접 입력 닫기 ▲' : '직접 입력 열기 ▼'}
                        </button>
                    </div>
                )}
            </div>

            {/* 선택된 조직원 요약 (목록이 접혀있을 때) */}
            {bothPickMethods && !isExpanded && selectedPassengers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                    {selectedPassengers.map((m: UserDoc) => (
                        <button
                            key={`selected-${m.id}`}
                            type="button"
                            onClick={() => togglePassenger(m)}
                            className="px-4 py-2 min-h-[48px] rounded-full text-xs font-medium border transition-all bg-primary-100 dark:bg-primary-900/40 border-primary-300 text-primary-700 dark:text-primary-300 ring-1 ring-primary-200 dark:ring-primary-900/40 shadow-sm"
                        >
                            ✓ {m.name || m.email?.split('@')[0]}
                        </button>
                    ))}
                </div>
            )}

            {/* 전체 조직원 목록 */}
            {members.length > 0 && listVisible && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                    {members.map((m: UserDoc) => {
                        const isSelected = selectedPassengers.some((p: UserDoc) => p.id === m.id);
                        return (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => togglePassenger(m)}
                                className={`px-4 py-2 min-h-[48px] rounded-full text-xs font-medium border transition-all ${isSelected
                                    ? 'bg-primary-100 dark:bg-primary-900/40 border-primary-300 text-primary-700 dark:text-primary-300 ring-1 ring-primary-200 dark:ring-primary-900/40'
                                    : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-primary-300 dark:hover:border-primary-700'
                                    }`}
                            >
                                {isSelected && '✓ '}{m.name || m.email?.split('@')[0]}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* 직접 입력(검색) 필드 */}
            {manualVisible && (
                <div className="mt-4 border-t border-surface-100 dark:border-surface-700 pt-3">
                    <p className="text-xs text-surface-500 dark:text-surface-400 mb-2">
                        이름 직접 입력
                    </p>
                    <div className="relative">
                        <input
                            ref={inputRef}
                            type="text"
                            value={externalPassengerNames}
                            onChange={handleManualInputChange}
                            onBlur={() => {
                                // 약간의 지연을 주어 클릭 이벤트가 먼저 발생하도록 함
                                setTimeout(() => {
                                    setAutocompleteState(prev => ({ ...prev, isOpen: false }));
                                }, 200);
                            }}
                            placeholder="예: 홍길동, 김철수, 이영희"
                            className="input min-h-[48px] text-sm py-1.5 px-3 w-full"
                        />
                        {autocompleteState.isOpen && (
                            <div className="absolute z-20 w-full mt-1 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-md shadow-lg max-h-48 overflow-y-auto">
                                {autocompleteState.suggestions.map(m => {
                                    const name = m.name || m.email?.split('@')[0];
                                    return (
                                        <button
                                            type="button"
                                            key={`auto-${m.id}`}
                                            onClick={() => handleSuggestionClick(m)}
                                            className="w-full text-left px-3 py-2.5 min-h-[48px] text-sm text-surface-700 dark:text-surface-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 cursor-pointer transition-colors border-b border-surface-100 dark:border-surface-700 last:border-0"
                                        >
                                            {name}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 외부 인원 (허용 시) */}
            {allowCount && (
            <div className="flex items-center gap-3 mt-4 border-t border-surface-100 dark:border-surface-700 pt-3">
                <p className="text-xs text-surface-500 dark:text-surface-400 whitespace-nowrap min-w-[3.5rem]">
                    {countLabel}
                </p>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => setExternalPassengerCount(Math.max(0, externalPassengerCount - 1))}
                        disabled={externalPassengerCount <= 0}
                        className="w-12 h-12 min-w-[48px] min-h-[48px] rounded-lg border border-surface-200 dark:border-surface-600 flex items-center justify-center text-sm font-bold text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-30 transition-all"
                    >
                        −
                    </button>
                    <span className="w-8 text-center font-bold text-surface-800 dark:text-surface-200">{externalPassengerCount}</span>
                    <button
                        type="button"
                        onClick={() => setExternalPassengerCount(externalPassengerCount + 1)}
                        className="w-12 h-12 min-w-[48px] min-h-[48px] rounded-lg border border-surface-200 dark:border-surface-600 flex items-center justify-center text-sm font-bold text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-all"
                    >
                        +
                    </button>
                    <span className="text-xs text-surface-400 dark:text-surface-500">명</span>
                </div>
            </div>
            )}

            {/* 총 탑승 인원 */}
            {(selectedPassengers.length + externalPassengerCount) > 0 && (
                <div className="mt-3 pt-2.5 border-t border-surface-100 dark:border-surface-700 text-xs text-surface-500 dark:text-surface-400">
                    👥 총 탑승 인원: <span className="font-bold text-surface-700 dark:text-surface-200">{selectedPassengers.length + externalPassengerCount + 1}명</span> (운전자 포함)
                </div>
            )}
        </div>
    );
});

export default PassengerSection;
