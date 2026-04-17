import React, { useMemo } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { tooltipStyle } from './dashboardUtils';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import type { TooltipContentProps } from 'recharts/types/component/Tooltip';

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
                    <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                        계기판 촬영(OCR)과 수동 입력의 일별 건수 (쌓기)
                    </p>
                    <div className="flex flex-col items-center justify-center py-12 text-surface-400">최근 발생한 데이터가 없습니다.</div>
                </div>
            );
        }
        return (
            <div className="glass-card p-5">
                <h2 className="text-lg font-semibold text-surface-800 dark:text-surface-200 mb-1">
                    📊 입력 방식 추이 (최근 30일)
                </h2>
                <p className="text-xs text-surface-400 dark:text-surface-500 mb-4">
                    계기판 촬영(OCR)과 수동 입력의 일별 건수 (쌓기)
                </p>
                <div>
                    <ResponsiveContainer width="100%" height={256} minWidth={1}>
                        <AreaChart data={inputMethodStats} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <defs>
                                <linearGradient id="colorOcr" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.05} />
                                </linearGradient>
                                <linearGradient id="colorManual" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.05} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false}
                                axisLine={{ stroke: '#4b5563' }} interval={Math.ceil(inputMethodStats.length / 8)} />
                            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} allowDecimals={false} />
                            <Tooltip {...tooltipStyle}
                                content={({ active, payload, label }: TooltipContentProps<ValueType, NameType>) => {
                                    if (!active || !payload?.length) return null;
                                    const data = payload[0]?.payload;
                                    if (!data) return null;
                                    const total = data.ocr + data.manual;
                                    return (
                                        <div style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                                            <p style={{ color: '#e5e7eb', fontWeight: 600, marginBottom: 6 }}>{label} <span style={{ color: '#9ca3af', fontWeight: 400 }}>총 {total}건</span></p>
                                            <p style={{ color: '#8b5cf6', margin: '3px 0' }}>
                                                📷 계기판 촬영: <b>{data.ocr}건</b>
                                            </p>
                                            <p style={{ color: '#06b6d4', margin: '3px 0' }}>
                                                ⌨️ 수동 입력: <b>{data.manual}건</b>
                                            </p>
                                        </div>
                                    );
                                }} />
                            <Legend formatter={(value: string) => value === 'ocr' ? '📷 계기판 촬영' : '⌨️ 수동 입력'}
                                wrapperStyle={{ fontSize: '13px', color: '#9ca3af' }} />
                            <Area type="monotone" dataKey="manual" stackId="input" stroke="#06b6d4" strokeWidth={2} fill="url(#colorManual)" />
                            <Area type="monotone" dataKey="ocr" stackId="input" stroke="#8b5cf6" strokeWidth={2} fill="url(#colorOcr)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>
        );
    }, [inputMethodStats]);

    return chartContent;
}

export default React.memo(ChartInputMethod);
