/**
 * HeatmapGrid — 운행 밀도 히트맵 (요일 × 시간대) 공유 컴포넌트
 * 행: 요일(월~일), 열: 시간대(06~18시)
 */

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

interface HeatmapGridProps {
    data: { grid: Record<number, Record<number, number>>; maxCount: number };
}

export default function HeatmapGrid({ data }: HeatmapGridProps) {
    const { grid, maxCount } = data;
    const hours = Array.from({ length: 13 }, (_, i) => i + 6); // 06시~18시 주요 시간만
    const dayOrder = [1, 2, 3, 4, 5, 6, 0]; // 월~금, 토, 일

    const getColor = (count: number = 0) => {
        if (!count) return 'bg-surface-100 dark:bg-surface-800';
        const intensity = Math.min(count / maxCount, 1);
        if (intensity < 0.25) return 'bg-primary-100 dark:bg-primary-900/40';
        if (intensity < 0.5) return 'bg-primary-200 dark:bg-primary-800/60';
        if (intensity < 0.75) return 'bg-primary-400 dark:bg-primary-600/80';
        return 'bg-primary-600 dark:bg-primary-500';
    };

    return (
        <div className="overflow-x-auto">
            <div className="min-w-[400px]">
                {/* 시간대 헤더 */}
                <div className="flex items-center gap-0.5 mb-0.5 pl-10">
                    {hours.map(h => (
                        <div key={h} className="flex-1 text-center text-[10px] font-medium text-surface-400 dark:text-surface-500">
                            {h}시
                        </div>
                    ))}
                </div>
                {/* 요일 행 */}
                {dayOrder.map(dayIdx => (
                    <div key={dayIdx} className="flex items-center gap-0.5 mb-0.5">
                        <span className={`w-9 text-xs font-medium text-right pr-1 font-mono ${dayIdx === 0 || dayIdx === 6 ? 'text-red-400' : 'text-surface-500 dark:text-surface-400'}`}>
                            {DAY_NAMES[dayIdx]}
                        </span>
                        {hours.map(h => (
                            <div
                                key={h}
                                className={`flex-1 aspect-square rounded-sm ${getColor(grid?.[dayIdx]?.[h] ?? 0)} transition-colors cursor-default`}
                                title={`${DAY_NAMES[dayIdx]} ${h}시: ${grid?.[dayIdx]?.[h] ?? 0}건`}
                            />
                        ))}
                    </div>
                ))}
                {/* 범례 */}
                <div className="flex items-center justify-end gap-1 mt-2 text-[10px] text-surface-400 dark:text-surface-500">
                    <span>적음</span>
                    <div className="w-3 h-3 rounded-sm bg-surface-100 dark:bg-surface-800" />
                    <div className="w-3 h-3 rounded-sm bg-primary-100 dark:bg-primary-900/40" />
                    <div className="w-3 h-3 rounded-sm bg-primary-200 dark:bg-primary-800/60" />
                    <div className="w-3 h-3 rounded-sm bg-primary-400 dark:bg-primary-600/80" />
                    <div className="w-3 h-3 rounded-sm bg-primary-600 dark:bg-primary-500" />
                    <span>많음</span>
                </div>
            </div>
        </div>
    );
}
