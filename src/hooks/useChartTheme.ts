/**
 * useChartTheme — Recharts 차트의 격자·축·툴팁 색을 라이트/다크에 맞춰 돌려준다.
 *
 * 통계·분석 화면의 차트들이 격자 `#e2e8f0`·축 글자 `#94a3b8`·흰 기본 툴팁을 하드코딩해,
 * 다크 모드에서 밝은 격자선이 화면을 가로지르고 툴팁이 흰 상자로 튀었다. Recharts는 CSS
 * 클래스(dark:)를 받지 않으므로 값 자체를 테마에 따라 바꿔 넘긴다(DriveOriginChart가 먼저 쓰던 방식).
 */
import type { CSSProperties } from 'react';
import { useThemeStore } from '../store/useThemeStore';

export interface ChartTheme {
    isDark: boolean;
    /** 차트 배경 — 누적 막대 조각 사이 틈(stroke) 등 */
    surface: string;
    grid: string;
    /** 축 눈금 글자 */
    tick: string;
    /** 이름 축(직원·차량명) 글자 — 눈금보다 한 단계 진하게 */
    tickStrong: string;
    /** 기본 <Tooltip>에 넘기는 스타일 */
    tooltip: {
        contentStyle: CSSProperties;
        labelStyle: CSSProperties;
        itemStyle: CSSProperties;
    };
    /** 호버 시 막대 뒤 하이라이트 */
    cursor: { fill: string };
}

export function chartTheme(isDark: boolean): ChartTheme {
    return {
        isDark,
        surface: isDark ? '#1e293b' : '#ffffff',
        grid: isDark ? '#334155' : '#e2e8f0',
        tick: isDark ? '#94a3b8' : '#94a3b8',
        tickStrong: isDark ? '#cbd5e1' : '#64748b',
        tooltip: {
            contentStyle: {
                backgroundColor: isDark ? '#1e293b' : '#ffffff',
                border: `1px solid ${isDark ? '#475569' : '#e2e8f0'}`,
                borderRadius: 12,
                fontSize: 13,
            },
            labelStyle: { color: isDark ? '#f1f5f9' : '#0f172a', fontWeight: 600 },
            itemStyle: { color: isDark ? '#cbd5e1' : '#334155' },
        },
        cursor: { fill: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.12)' },
    };
}

export default function useChartTheme(): ChartTheme {
    const isDark = useThemeStore(s => s.theme === 'dark');
    return chartTheme(isDark);
}

/**
 * 금액 축 눈금 — 1만 원 이상은 '만' 단위(소수 한 자리까지), 그 미만은 원 그대로.
 * 예전 `(v / 10000).toFixed(0)만`은 1만 원 미만이 전부 "0만"이 됐다.
 */
export function formatWonTick(v: number): string {
    if (!Number.isFinite(v)) return '';
    if (Math.abs(v) < 10000) return v.toLocaleString();
    const man = Math.round(v / 1000) / 10;
    return `${man.toLocaleString()}만`;
}
