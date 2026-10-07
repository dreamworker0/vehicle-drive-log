/**
 * TrendCharts — 관리자 [분석]의 추이 차트 묶음
 *
 * Recharts는 jsdom에서 레이아웃이 잡히지 않아 실제 그래프를 그리지 않는다. 그래서 차트
 * 프리미티브는 대체하고 **이 컴포넌트가 결정하는 것**만 고정한다:
 *  - 데이터가 없을 때의 안내 문구 (빈 차트 축만 덩그러니 남지 않게)
 *  - 직원 비교는 상위 10명까지 (그 이상은 세로로 끝없이 늘어난다)
 *  - 월 라벨은 데이터에서 읽어 막대를 만든다 (하드코딩이 아님)
 *  - 비용이 전부 0이면 비용 차트 자체를 숨긴다
 *  - 툴팁은 활성 상태이고 값이 있을 때만 그린다
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/** 차트 프리미티브 대체 — 어떤 데이터가 어떤 dataKey로 넘어갔는지만 남긴다 */
vi.mock('recharts', () => {
    const box = (name: string) => ({ children, data, dataKey }: {
        children?: React.ReactNode; data?: unknown[]; dataKey?: string;
    }) => (
        <div data-testid={name} data-count={data?.length} data-key={dataKey}>{children}</div>
    );
    return {
        ResponsiveContainer: box('responsive'),
        LineChart: box('line-chart'),
        BarChart: box('bar-chart'),
        Line: box('line'),
        Bar: box('bar'),
        XAxis: box('x-axis'),
        YAxis: box('y-axis'),
        CartesianGrid: box('grid'),
        Tooltip: box('tooltip'),
        Legend: box('legend'),
        // 막대별 색 — fill만 남겨 어떤 색이 매겨졌는지 본다
        Cell: ({ fill }: { fill?: string }) => <div data-testid="cell" data-fill={fill} />,
    };
});

vi.mock('../../components/common/HeatmapGrid', () => ({
    default: ({ data }: { data: { maxCount: number } }) => (
        <div data-testid="heatmap" data-max={data?.maxCount} />
    ),
}));

import TrendCharts from '../../components/admin/TrendCharts';

const emptyProps = {
    monthlyTrend: [],
    driveOriginTrend: [],
    driverComparison: [],
    vehicleUtilization: [],
    heatmapData: { grid: {}, maxCount: 1 },
};

type Props = React.ComponentProps<typeof TrendCharts>;

function setup(over: Partial<Props> = {}) {
    return render(<TrendCharts {...emptyProps} {...over} />);
}

describe('데이터가 없을 때', () => {
    it('빈 차트 대신 안내 문구를 보여준다', () => {
        setup();
        expect(screen.getAllByText('데이터가 없습니다')).toHaveLength(3); // 월별 추이 · 운행 방식 · 직원 비교
        expect(screen.getByText('차량 데이터가 없습니다')).toBeInTheDocument();
        expect(screen.queryAllByTestId('line-chart')).toHaveLength(0);
    });

    it('히트맵은 데이터가 없어도 자리를 지킨다 (요일×시간 격자 자체가 정보)', () => {
        setup();
        expect(screen.getByTestId('heatmap')).toBeInTheDocument();
    });
});

describe('월별 추이', () => {
    it('건수와 거리를 한 차트의 양쪽 축에 그리지 않고 두 차트로 나눈다', () => {
        setup({ monthlyTrend: [{ label: '1월', count: 3, distance: 120 }] });
        const charts = screen.getAllByTestId('line-chart');
        expect(charts).toHaveLength(2);
        expect(screen.getAllByTestId('line').map(l => l.getAttribute('data-key'))).toEqual(['count', 'distance']);
        expect(screen.getByText('운행 횟수 (건)')).toBeInTheDocument();
        expect(screen.getByText('주행거리 (km)')).toBeInTheDocument();
    });

    it('달은 있어도 전부 0이면 빈 0 선 대신 안내 문구를 보여 준다', () => {
        setup({ monthlyTrend: [{ label: '1월', count: 0, distance: 0 }, { label: '2월', count: 0, distance: 0 }] });
        expect(screen.queryAllByTestId('line-chart')).toHaveLength(0);
    });
});

describe('직원별 비교', () => {
    const driver = (name: string) => ({ name, monthLabels: ['1월', '2월', '3월'], '1월_count': 1, '2월_count': 2, '3월_count': 3 });

    it('상위 10명까지만 넘긴다', () => {
        setup({ driverComparison: Array.from({ length: 15 }, (_, i) => driver(`직원${i}`)) });
        const charts = screen.getAllByTestId('bar-chart');
        expect(charts[0]).toHaveAttribute('data-count', '10');
    });

    it('월 라벨 수만큼 막대를 만든다 — 라벨은 데이터에서 읽는다', () => {
        setup({ driverComparison: [driver('홍길동')] });
        const bars = screen.getAllByTestId('bar');
        expect(bars.filter(b => /월_count$/.test(b.getAttribute('data-key') || ''))).toHaveLength(3);
    });

    it('월 라벨이 없으면 막대를 만들지 않는다 (빈 축만 남지 않게)', () => {
        setup({ driverComparison: [{ name: '홍길동' }] });
        const bars = screen.queryAllByTestId('bar');
        expect(bars.filter(b => /월_count$/.test(b.getAttribute('data-key') || ''))).toHaveLength(0);
    });
});

describe('차량 가동률', () => {
    it('차량이 있으면 가동률 막대를 그린다', () => {
        setup({ vehicleUtilization: [{ name: '카니발', rate: 42, usedDays: 25, totalWorkdays: 60 }] });
        expect(screen.queryByText('차량 데이터가 없습니다')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('bar').some(b => b.getAttribute('data-key') === 'rate')).toBe(true);
    });

    it('가동률 구간별로 막대 색을 매긴다 — 예전 <rect>는 Recharts가 무시해 전부 한 색이었다', () => {
        setup({ vehicleUtilization: [
            { name: '카니발', rate: 75, usedDays: 45, totalWorkdays: 60 },
            { name: '레이', rate: 40, usedDays: 24, totalWorkdays: 60 },
            { name: '포터', rate: 10, usedDays: 6, totalWorkdays: 60 },
        ] });
        expect(screen.getAllByTestId('cell').map(c => c.getAttribute('data-fill'))).toEqual(['#10b981', '#f59e0b', '#ef4444']);
    });
});

describe('월별 비용 추이', () => {
    it('트렌드 탭에는 두지 않는다 — 정비비까지 담은 비용 최적화 탭의 차트가 정본이다', () => {
        setup();
        expect(screen.queryByText(/월별 비용 추이/)).not.toBeInTheDocument();
    });
});

describe('섹션 제목', () => {
    it('네 영역의 제목이 모두 보인다', () => {
        setup();
        for (const title of ['월별 운행 추이', '운행 방식', '직원별 운행 비교 (최근 3개월)', '차량 가동률 (최근 3개월)', '운행 밀도 히트맵 (시간대 × 요일)']) {
            expect(screen.getByText(title)).toBeInTheDocument();
        }
    });
});
