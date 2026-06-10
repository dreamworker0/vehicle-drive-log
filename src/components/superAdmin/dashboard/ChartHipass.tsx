import React, { useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Cell,
    PieChart, Pie,
} from 'recharts';
import { tooltipStyle, tooltipFormatter } from './dashboardUtils';

interface Props {
    hipassRatio: { withHipass: number; withoutHipass: number };
    hipassTopOrgs: { name: string; count: number }[];
}

function ChartHipass({ hipassRatio, hipassTopOrgs }: Props) {
    const chartContent = useMemo(() => {
        if (hipassRatio.withHipass === 0 && hipassRatio.withoutHipass === 0) {
            return (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="glass-card p-5">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                            🛣️ 하이패스 연결 비율
                        </h2>
                        <div className="flex flex-col items-center justify-center py-12 text-surface-400 dark:text-surface-500">데이터가 없습니다.</div>
                    </div>
                    <div className="glass-card p-5">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                            🏆 하이패스 사용 기관 TOP 5
                        </h2>
                        <div className="flex flex-col items-center justify-center py-12 text-surface-400 dark:text-surface-500">데이터가 없습니다.</div>
                    </div>
                </div>
            );
        }
        const total = hipassRatio.withHipass + hipassRatio.withoutHipass;
        const pct = total > 0 ? Math.round((hipassRatio.withHipass / total) * 100) : 0;
        const donutData = [
            { name: '연결됨', value: hipassRatio.withHipass, color: '#14b8a6' },
            { name: '미연결', value: hipassRatio.withoutHipass, color: '#374151' },
        ];

        return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 하이패스 연결 비율 도넛 */}
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                        🛣️ 하이패스 연결 비율
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
                                <span className="text-3xl font-bold text-teal-500 dark:text-teal-400">{pct}%</span>
                                <span className="text-xs text-surface-400 dark:text-surface-500">연결율</span>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#14b8a6' }} />
                                <span className="text-sm text-surface-600 dark:text-surface-300">연결됨</span>
                                <span className="text-sm font-bold text-surface-800 dark:text-surface-100 ml-auto">{hipassRatio.withHipass}대</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#374151' }} />
                                <span className="text-sm text-surface-600 dark:text-surface-300">미연결</span>
                                <span className="text-sm font-bold text-surface-800 dark:text-surface-100 ml-auto">{hipassRatio.withoutHipass}대</span>
                            </div>
                            <div className="border-t border-surface-200 dark:border-surface-700 pt-2">
                                <span className="text-xs text-surface-400 dark:text-surface-500">전체 {total}대</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 하이패스 사용 기관 TOP 5 */}
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-4">
                        🏆 하이패스 사용 기관 TOP 5
                    </h2>
                    {hipassTopOrgs.length > 0 ? (
                        <ResponsiveContainer width="100%" height={220} minWidth={1}>
                            <BarChart data={hipassTopOrgs} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} horizontal={false} />
                                <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                    axisLine={false} allowDecimals={false} />
                                <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#d1d5db' }} tickLine={false}
                                    axisLine={false} width={100} />
                                <Tooltip {...tooltipStyle} formatter={tooltipFormatter('대', '하이패스 차량')} />
                                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                                    {hipassTopOrgs.map((_entry, idx) => (
                                        <Cell key={idx} fill={`hsl(${170 - idx * 12}, 65%, ${45 + idx * 5}%)`} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <p className="text-sm text-surface-400 dark:text-surface-500">하이패스 연결 차량이 없습니다</p>
                    )}
                </div>
            </div>
        );
    }, [hipassRatio, hipassTopOrgs]);

    return chartContent;
}

export default React.memo(ChartHipass);
