import { memo, useState, useEffect } from 'react';
import type { User as UserDoc } from '../../../types/user';

interface PassengerSectionProps {
    members: UserDoc[];
    selectedPassengers: UserDoc[];
    externalPassengerCount: number;
    togglePassenger: (user: UserDoc) => void;
    setExternalPassengerCount: (count: number) => void;
}

const PassengerSection = memo(function PassengerSection({
    members,
    selectedPassengers,
    externalPassengerCount,
    togglePassenger,
    setExternalPassengerCount
}: PassengerSectionProps) {
    // 로컬 스토리지에서 이전 상태 불러오기 (기본값: false)
    const [isExpanded, setIsExpanded] = useState(() => {
        try {
            const saved = localStorage.getItem('driveLog_passengerExpanded');
            return saved !== null ? JSON.parse(saved) : false;
        } catch {
            return false;
        }
    });

    // 상태 변경 시 로컬 스토리지에 저장
    useEffect(() => {
        localStorage.setItem('driveLog_passengerExpanded', JSON.stringify(isExpanded));
    }, [isExpanded]);

    return (
        <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-3">
                <label className="label mb-0">
                    🧑‍🤝‍🧑 동승자
                    {(selectedPassengers.length + externalPassengerCount) > 0 && (
                        <span className="ml-2 text-primary-600 font-bold">
                            {selectedPassengers.length + externalPassengerCount}명
                        </span>
                    )}
                </label>
                {members.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="text-xs px-2.5 py-1 rounded-md bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors flex items-center font-medium"
                    >
                        {isExpanded ? '직원 목록 닫기 ▲' : '직원 선택 ▼'}
                    </button>
                )}
            </div>

            {/* 선택된 조직원 요약 (접혀있을 때) */}
            {!isExpanded && selectedPassengers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                    {selectedPassengers.map((m: UserDoc) => (
                        <button
                            key={`selected-${m.id}`}
                            type="button"
                            onClick={() => togglePassenger(m)}
                            className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all bg-primary-100 border-primary-300 text-primary-700 ring-1 ring-primary-200 shadow-sm"
                        >
                            ✓ {m.name || m.email?.split('@')[0]}
                        </button>
                    ))}
                </div>
            )}

            {/* 전체 조직원 목록 (펼쳐있을 때) */}
            {members.length > 0 && isExpanded && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                    {members.map((m: UserDoc) => {
                        const isSelected = selectedPassengers.some((p: UserDoc) => p.id === m.id);
                        return (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => togglePassenger(m)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${isSelected
                                    ? 'bg-primary-100 border-primary-300 text-primary-700 ring-1 ring-primary-200'
                                    : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:border-primary-300'
                                    }`}
                            >
                                {isSelected && '✓ '}{m.name || m.email?.split('@')[0]}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* 외부 인원 */}
            <div className="flex items-center gap-3 mt-1">
                <p className="text-xs text-surface-500 dark:text-surface-400 whitespace-nowrap min-w-[3.5rem]">
                    {isExpanded ? '외부 인원' : '인원'}
                </p>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => setExternalPassengerCount(Math.max(0, externalPassengerCount - 1))}
                        disabled={externalPassengerCount <= 0}
                        className="w-8 h-8 rounded-lg border border-surface-200 dark:border-surface-600 flex items-center justify-center text-sm font-bold text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-30 transition-all"
                    >
                        −
                    </button>
                    <span className="w-8 text-center font-bold text-surface-800 dark:text-surface-200">{externalPassengerCount}</span>
                    <button
                        type="button"
                        onClick={() => setExternalPassengerCount(externalPassengerCount + 1)}
                        className="w-8 h-8 rounded-lg border border-surface-200 dark:border-surface-600 flex items-center justify-center text-sm font-bold text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-all"
                    >
                        +
                    </button>
                    <span className="text-xs text-surface-400">명</span>
                </div>
            </div>

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
