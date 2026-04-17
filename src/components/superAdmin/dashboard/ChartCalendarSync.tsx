import React, { useMemo } from 'react';
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip
} from 'recharts';
import { tooltipStyle, tooltipFormatter } from './dashboardUtils';

interface Props {
    calendarSyncRatio: { sync: number; notSync: number };
    calendarTopOrgs: { name: string; count: number }[];
    calendarSyncOrgs: number;
}

function ChartCalendarSync({ calendarSyncRatio, calendarTopOrgs, calendarSyncOrgs }: Props) {
    const chartContent = useMemo(() => {
        if (calendarSyncRatio.sync === 0 && calendarSyncRatio.notSync === 0) {
            return (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                    <div className="glass-card p-5">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4 flex items-center gap-2">
                            <span role="img" aria-label="calendar">📅</span> 구글 캘린더 연동 비율
                        </h2>
                        <div className="flex flex-col items-center justify-center py-12 text-surface-400">데이터가 없습니다.</div>
                    </div>
                </div>
            );
        }

        const total = calendarSyncRatio.sync + calendarSyncRatio.notSync;
        const pct = total > 0 ? Math.round((calendarSyncRatio.sync / total) * 100) : 0;

        const donutData = [
            { name: '연동됨', value: calendarSyncRatio.sync, color: '#3b82f6' },
            { name: '미연동', value: calendarSyncRatio.notSync, color: '#374151' },
        ];

        return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                {/* 구글 캘린더 연동 비율 도넛 */}
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4 flex items-center gap-2">
                        <span role="img" aria-label="calendar">📅</span> 구글 캘린더 연동 비율
                    </h2>
                    <div className="flex items-center justify-center gap-8">
                        <div className="relative">
                            <ResponsiveContainer width={180} height={180}>
                                <PieChart>
                                    <Pie
                                        data={donutData}
                                        dataKey="value"
                                        cx="50%" cy="50%"
                                        innerRadius={55} outerRadius={80}
                                        paddingAngle={3}
                                        startAngle={90} endAngle={-270}
                                        stroke="none"
                                    >
                                        {donutData.map((entry, idx) => (
                                            <Cell key={idx} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        {...tooltipStyle}
                                        formatter={tooltipFormatter('대', '')}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                            {/* 중앙 텍스트 */}
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <span className="text-3xl font-bold text-blue-500 dark:text-blue-400">{pct}%</span>
                                <span className="text-xs text-surface-400 dark:text-surface-500">연동율</span>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-blue-500" />
                                <span className="text-sm text-surface-600 dark:text-surface-300">연동됨</span>
                                <span className="text-sm font-bold text-surface-800 dark:text-surface-100 ml-auto">{calendarSyncRatio.sync}대</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-surface-600" />
                                <span className="text-sm text-surface-600 dark:text-surface-300">미연동</span>
                                <span className="text-sm font-bold text-surface-800 dark:text-surface-100 ml-auto">{calendarSyncRatio.notSync}대</span>
                            </div>
                            <div className="border-t border-surface-200 dark:border-surface-700 pt-2">
                                <span className="text-xs text-surface-400 dark:text-surface-500">전체 {total}대</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 안내 및 인사이트 요약 영역 */}
                <div className="glass-card p-5 flex flex-col justify-center">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-md font-semibold text-surface-800 dark:text-surface-200">
                            💡 캘린더 연동 인사이트
                        </h3>
                        {calendarSyncOrgs > 0 && (
                            <span className="text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-800/50 shadow-sm">
                                1대 이상 연동: {calendarSyncOrgs}개 기관
                            </span>
                        )}
                    </div>

                    {/* 연동 기관 TOP 10 */}
                    {calendarTopOrgs.length > 0 && (
                        <div className="mb-4">
                            <h4 className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider mb-2">
                                🏆 연동 기관 TOP 10
                            </h4>
                            <div className="space-y-1.5">
                                {calendarTopOrgs.map((org, idx) => {
                                    const maxCount = calendarTopOrgs[0]?.count || 1;
                                    const barWidth = Math.max((org.count / maxCount) * 100, 8);
                                    const medals = ['🥇', '🥈', '🥉'];
                                    return (
                                        <div key={idx} className="flex items-center gap-2 text-xs">
                                            <span className="w-5 text-center shrink-0">
                                                {idx < 3 ? medals[idx] : `${idx + 1}`}
                                            </span>
                                            <span className="w-28 truncate text-surface-700 dark:text-surface-300 shrink-0" title={org.name}>
                                                {org.name}
                                            </span>
                                            <div className="flex-1 bg-surface-100 dark:bg-surface-700 rounded-full h-4 overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 flex items-center justify-end pr-1.5 transition-all duration-500"
                                                    style={{ width: `${barWidth}%` }}
                                                >
                                                    <span className="text-[10px] font-bold text-white">{org.count}대</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }, [calendarSyncRatio, calendarTopOrgs, calendarSyncOrgs]);

    return chartContent;
}

export default React.memo(ChartCalendarSync);
