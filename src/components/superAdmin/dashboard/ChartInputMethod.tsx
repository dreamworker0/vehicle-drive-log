import React, { useMemo } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { tooltipStyle } from './dashboardUtils';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import type { TooltipContentProps } from 'recharts/types/component/Tooltip';
import { CHART_NEUTRAL, CHART_SERIES } from '../../../lib/chartPalette';

interface Props {
    inputMethodStats: { date: string; ocr: number; manual: number }[];
}

function ChartInputMethod({ inputMethodStats }: Props) {
    const chartContent = useMemo(() => {
        if (!inputMethodStats || inputMethodStats.length === 0) {
            return (
                <div className="glass-card p-5">
                    <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                        📊 입력 방식 추이 (최근 30일)
                    </h2>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mb-4">
                        계기판 촬영(OCR)과 수동 입력의 일별 건수 (쌓기)
                    </p>
                    <div className="flex flex-col items-center justify-center py-12 text-surface-500 dark:text-surface-400">최근 발생한 데이터가 없습니다.</div>
                </div>
            );
        }
        return (
            <div className="glass-card p-5">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                    📊 입력 방식 추이 (최근 30일)
                </h2>
                <p className="text-xs text-surface-500 dark:text-surface-400 mb-4">
                    계기판 촬영(OCR)과 수동 입력의 일별 건수 (쌓기)
                </p>
                <div>
                    <ResponsiveContainer width="100%" height={256} minWidth={1}>
                        <AreaChart data={inputMethodStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <defs>
                                <linearGradient id="colorOcr" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={CHART_SERIES.violet} stopOpacity={0.4} />
                                    <stop offset="95%" stopColor={CHART_SERIES.violet} stopOpacity={0.05} />
                                </linearGradient>
                                <linearGradient id="colorManual" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={CHART_SERIES.cyan} stopOpacity={0.4} />
                                    <stop offset="95%" stopColor={CHART_SERIES.cyan} stopOpacity={0.05} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL[700]} opacity={0.3} />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: CHART_NEUTRAL[400] }} tickLine={false}
                                axisLine={{ stroke: CHART_NEUTRAL[600] }} interval={Math.ceil(inputMethodStats.length / 8)} />
                            <YAxis tick={{ fontSize: 11, fill: CHART_NEUTRAL[400] }} tickLine={false} axisLine={false} allowDecimals={false} />
                            <Tooltip {...tooltipStyle}
                                content={({ active, payload, label }: TooltipContentProps<ValueType, NameType>) => {
                                    if (!active || !payload?.length) return null;
                                    const data = payload[0]?.payload;
                                    if (!data) return null;
                                    const total = data.ocr + data.manual;
                                    return (
                                        <div style={{ background: CHART_NEUTRAL[800], border: `1px solid ${CHART_NEUTRAL[700]}`, borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                                            <p style={{ color: CHART_NEUTRAL[200], fontWeight: 600, marginBottom: 6 }}>{label} <span style={{ color: CHART_NEUTRAL[400], fontWeight: 400 }}>총 {total}건</span></p>
                                            <p style={{ color: CHART_SERIES.violet, margin: '3px 0' }}>
                                                📷 계기판 촬영: <b>{data.ocr}건</b>
                                            </p>
                                            <p style={{ color: CHART_SERIES.cyan, margin: '3px 0' }}>
                                                ⌨️ 수동 입력: <b>{data.manual}건</b>
                                            </p>
                                        </div>
                                    );
                                }} />
                            <Legend formatter={(value: string) => value === 'ocr' ? '📷 계기판 촬영' : '⌨️ 수동 입력'}
                                wrapperStyle={{ fontSize: '13px', color: CHART_NEUTRAL[400] }} />
                            <Area type="monotone" dataKey="manual" stackId="input" stroke={CHART_SERIES.cyan} strokeWidth={2} fill="url(#colorManual)" />
                            <Area type="monotone" dataKey="ocr" stackId="input" stroke={CHART_SERIES.violet} strokeWidth={2} fill="url(#colorOcr)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>
        );
    }, [inputMethodStats]);

    return chartContent;
}

export default React.memo(ChartInputMethod);
