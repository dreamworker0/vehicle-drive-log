import React, { useMemo } from 'react';
import type { FunnelStep } from './dashboardUtils';

interface Props {
    funnelData: FunnelStep[];
}

function DashboardFunnelChart({ funnelData }: Props) {
    const chartContent = useMemo(() => {
        if (!funnelData || funnelData.length === 0) {
            return (
                <div className="glass-card p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">
                            🔄 기관 활성화 퍼널
                        </h2>
                    </div>
                    <div className="flex flex-col items-center justify-center py-12 text-surface-400 dark:text-surface-500">최근 발생한 데이터가 없습니다.</div>
                </div>
            );
        }

        const overallRate = funnelData.length > 1
            ? Math.round((funnelData[funnelData.length - 1].value / funnelData[0].value) * 100)
            : 100;

        return (
            <div className="glass-card p-5">
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200">
                        🔄 기관 활성화 퍼널
                    </h2>
                    <span className="text-xs text-surface-400 dark:text-surface-500">
                        전체 전환율 {overallRate}%
                    </span>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {funnelData.map((step, idx) => {
                        // 프로그레스바 너비 (첫 단계 기준 비율)
                        const progressWidth = funnelData[0].value > 0
                            ? Math.round((step.value / funnelData[0].value) * 100)
                            : 0;

                        return (
                            <div key={step.label} className="relative group">
                                {/* 박스 카드 */}
                                <div className="
                                    relative overflow-hidden rounded-2xl p-4
                                    bg-white dark:bg-surface-800
                                    border border-surface-200 dark:border-surface-700
                                    shadow-sm hover:shadow-md
                                    transition-all duration-200
                                    hover:-translate-y-0.5
                                ">
                                    {/* 프로그레스 배경바 */}
                                    <div
                                        className="absolute inset-0 opacity-[0.07] dark:opacity-[0.12] rounded-2xl transition-all"
                                        style={{
                                            background: `linear-gradient(135deg, ${step.color}, transparent)`,
                                            width: `${progressWidth}%`,
                                        }}
                                    />

                                    {/* 상단: 아이콘 + 단계 번호 */}
                                    <div className="relative flex items-center justify-between mb-3">
                                        <span className="text-2xl">{step.icon}</span>
                                        <span className="text-[10px] font-mono text-surface-400 dark:text-surface-500 bg-surface-100 dark:bg-surface-700 px-1.5 py-0.5 rounded-full">
                                            STEP {idx + 1}
                                        </span>
                                    </div>

                                    {/* 숫자 */}
                                    <div className="relative">
                                        <p className="text-3xl font-bold text-surface-800 dark:text-surface-100 tracking-tight">
                                            {step.value.toLocaleString()}
                                        </p>
                                        <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mt-1">
                                            {step.label}
                                        </p>
                                    </div>

                                    {/* 하단 통계 */}
                                    <div className="relative flex items-center gap-2 mt-3 pt-3 border-t border-surface-100 dark:border-surface-700">
                                        {/* 전체 대비 비율 */}
                                        <span
                                            className="text-xs font-semibold px-1.5 py-0.5 rounded-md"
                                            style={{
                                                backgroundColor: `${step.color}20`,
                                                color: step.color,
                                            }}
                                        >
                                            {step.rate}%
                                        </span>
                                        {/* 이전 단계 대비 감소 */}
                                        {idx > 0 && step.dropoff > 0 && (
                                            <span className="text-[11px] text-rose-500 dark:text-rose-400 font-medium">
                                                ▼{step.dropoff}
                                                <span className="text-surface-400 dark:text-surface-500 ml-0.5">
                                                    ({step.conversionFromPrev}%)
                                                </span>
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* 단계 간 화살표 (마지막이 아닌 경우, 큰 화면에서만) */}
                                {idx < funnelData.length - 1 && (
                                    <div className="hidden lg:flex absolute -right-2 top-1/2 -translate-y-1/2 z-10 text-surface-300 dark:text-surface-600">
                                        <svg width="12" height="16" viewBox="0 0 12 16" fill="none">
                                            <path d="M2 1L10 8L2 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }, [funnelData]);

    return chartContent;
}

export default React.memo(DashboardFunnelChart);
