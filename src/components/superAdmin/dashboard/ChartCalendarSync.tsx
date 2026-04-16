import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip
} from 'recharts';
import { tooltipStyle, tooltipFormatter } from './dashboardUtils';

interface Props {
    calendarSyncRatio: { sync: number; notSync: number };
}

export default function ChartCalendarSync({ calendarSyncRatio }: Props) {
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
        { name: '연동됨', value: calendarSyncRatio.sync, color: '#3b82f6' }, // Blue
        { name: '미연동', value: calendarSyncRatio.notSync, color: '#374151' }, // Gray
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
                <h3 className="text-md font-semibold text-surface-800 dark:text-surface-200 mb-3 block">
                    💡 캘린더 연동 인사이트
                </h3>
                <p className="text-sm text-surface-600 dark:text-surface-300 mb-4 leading-relaxed">
                    구글 캘린더를 연동한 차량에서는 <strong>사전 예약 생성 시 자동으로 캘린더에 일정 등록</strong> 및 변동 알림이 연동됩니다. 
                    연동률을 높이면 운행 스케줄 관리가 더욱 직관적이고 효율적으로 변합니다.
                </p>
                <div className="bg-blue-50/50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-100 dark:border-blue-800/30">
                    {pct >= 50 ? (
                        <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                            {pct}%의 높은 연동률을 보이고 있습니다. 서비스 효율성이 증가하고 있습니다!
                        </p>
                    ) : (
                        <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                            현재 {pct}%로 절반 이상의 차량이 미연동 상태입니다. 각 기관에 연동 가이드를 안내해 보세요.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
