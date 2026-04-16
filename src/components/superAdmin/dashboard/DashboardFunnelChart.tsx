import type { FunnelStep } from './dashboardUtils';

interface Props {
    funnelData: FunnelStep[];
}

export default function DashboardFunnelChart({ funnelData }: Props) {
    if (funnelData.length === 0) {
        return (
            <div className="glass-card p-5">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">
                        🔄 기관 활성화 퍼널
                    </h2>
                </div>
                <div className="flex flex-col items-center justify-center py-12 text-surface-400">최근 발생한 데이터가 없습니다.</div>
            </div>
        );
    }

    const overallRate = funnelData.length > 1
        ? Math.round((funnelData[funnelData.length - 1].value / funnelData[0].value) * 100)
        : 100;

    return (
        <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">
                    🔄 기관 활성화 퍼널
                </h2>
                <span className="text-xs text-surface-400 dark:text-surface-500">
                    전체 전환율 {overallRate}%
                </span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {funnelData.map((step, idx) => (
                    <div key={step.label} className="relative">
                        <div className={`bg-gradient-to-r ${step.gradient} rounded-xl p-4 text-white`}>
                            <div className="text-2xl mb-1">{step.icon}</div>
                            <p className="text-2xl font-bold">{step.value}</p>
                            <p className="text-xs opacity-80 mt-0.5">{step.label}</p>
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-xs">
                            <span className="text-surface-500 dark:text-surface-400">{step.rate}%</span>
                            {idx > 0 && step.dropoff > 0 && (
                                <span className="text-rose-400 dark:text-rose-500">
                                    ▼{step.dropoff} ({step.conversionFromPrev}%)
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
