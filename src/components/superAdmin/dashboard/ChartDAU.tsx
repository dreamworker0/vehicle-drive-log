import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer,
} from 'recharts';
import { tooltipStyle, tooltipFormatter } from './dashboardUtils';

interface Props {
    dailyActiveUserStats: { date: string; users: number }[];
}

export default function ChartDAU({ dailyActiveUserStats }: Props) {
    if (!dailyActiveUserStats || dailyActiveUserStats.length === 0) {
        return (
            <div className="glass-card p-5">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                    👤 일별 활성 사용자 (DAU)
                </h2>
                <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">출발 기록이 있는 고유 사용자 수</p>
                <div className="flex flex-col items-center justify-center py-12 text-surface-400">최근 발생한 데이터가 없습니다.</div>
            </div>
        );
    }
    return (
        <div className="glass-card p-5">
            <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                👤 일별 활성 사용자 (DAU)
            </h2>
            <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">출발 기록이 있는 고유 사용자 수</p>
            <div>
                <ResponsiveContainer width="100%" height={256} minWidth={1}>
                    <AreaChart data={dailyActiveUserStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                        <defs>
                            <linearGradient id="colorDau" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                            axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(dailyActiveUserStats.length / 8)} />
                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip {...tooltipStyle}
                            formatter={tooltipFormatter('명', '활성 사용자')}
                        />
                        <Area type="monotone" dataKey="users" stroke="#06b6d4" strokeWidth={2.5}
                            fill="url(#colorDau)" dot={{ r: 2, fill: '#06b6d4' }} activeDot={{ r: 5, fill: '#06b6d4' }} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
