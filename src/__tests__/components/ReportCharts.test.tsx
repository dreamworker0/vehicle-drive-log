/**
 * ReportCharts — 관리자 [보고서]의 차트 묶음
 *
 * Recharts는 jsdom에서 레이아웃이 잡히지 않으므로 프리미티브를 대체하고,
 * **이 컴포넌트가 결정하는 것**만 고정한다:
 *  - 섹션별 표시/숨김 조건 (기록이 없으면 빈 축 대신 안내를, 점 하나짜리 추이는 아예 감춤)
 *  - 시간대 차트는 06~22시만 색을 입힌다(새벽 구간까지 그리면 대부분 빈 칸이다)
 *  - 툴팁 문구가 지표에 맞는 단위를 붙인다(km / 건 / 원)
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('recharts', () => {
    const box = (name: string) => ({ children, data, dataKey }: {
        children?: React.ReactNode; data?: unknown[]; dataKey?: string;
    }) => (
        <div data-testid={name} data-count={data?.length} data-key={dataKey}>{children}</div>
    );
    return {
        ResponsiveContainer: box('responsive'),
        BarChart: box('bar-chart'),
        LineChart: box('line-chart'),
        AreaChart: box('area-chart'),
        PieChart: box('pie-chart'),
        Bar: box('bar'),
        Line: box('line'),
        Area: box('area'),
        Pie: box('pie'),
        Cell: box('cell'),
        XAxis: box('x-axis'),
        YAxis: box('y-axis'),
        CartesianGrid: box('grid'),
        Tooltip: box('tooltip'),
        Legend: box('legend'),
    };
});

import ReportCharts from '../../components/admin/ReportCharts';

type Props = React.ComponentProps<typeof ReportCharts>;

const empty: Props = {
    driverData: [],
    vehicleData: [],
    purposeData: [],
    dayOfWeekData: [],
    hourlyData: [],
    vehicleFuelData: [],
    dailyTrendData: [],
    fuelLogStats: { totalCost: 0, totalAmount: 0, count: 0, vehicleData: [] },
    hipassChargeStats: { totalAmount: 0, count: 0, vehicleData: [] },
    costTrendData: [],
};

function setup(over: Partial<Props> = {}) {
    return render(<ReportCharts {...empty} {...over} />);
}

describe('기록이 없을 때', () => {
    it('주유·하이패스 섹션은 빈 차트 대신 안내를 보여준다', () => {
        setup();
        expect(screen.getByText('주유 기록이 없습니다')).toBeInTheDocument();
        expect(screen.getByText('하이패스 충전 기록이 없습니다')).toBeInTheDocument();
    });

    it('선택 섹션(차량별 연료·일별 추이·비용 추이)은 아예 그리지 않는다', () => {
        setup();
        expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
        expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    });
});

describe('일별 추이 / 비용 추이의 표시 조건', () => {
    const day = (date: string) => ({ date, count: 1, distance: 10 });
    const cost = (date: string) => ({ date, fuel: 1000, hipass: 500, total: 1500 });

    it('하루치뿐이면 추이를 그리지 않는다 — 점 하나로는 추세가 아니다', () => {
        setup({ dailyTrendData: [day('03-05')], costTrendData: [cost('03-05')] });
        expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
        expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument();
    });

    it('이틀 이상이면 그린다', () => {
        setup({ dailyTrendData: [day('03-05'), day('03-06')], costTrendData: [cost('03-05'), cost('03-06')] });
        expect(screen.getByTestId('line-chart')).toHaveAttribute('data-count', '2');
        expect(screen.getByTestId('area-chart')).toHaveAttribute('data-count', '2');
    });
});

describe('차량별 연료 사용량', () => {
    it('데이터가 있을 때만 섹션을 만든다', () => {
        const { unmount } = setup();
        const before = screen.queryAllByTestId('bar-chart').length;
        unmount();

        setup({ vehicleFuelData: [{ name: '카니발', amount: 120 }] });
        expect(screen.queryAllByTestId('bar-chart').length).toBeGreaterThan(before);
    });
});

describe('시간대별 운행', () => {
    /** 0~23시 전부 채운 입력 */
    const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}시`, count: h }));

    it('06~22시만 그린다 — 새벽까지 그리면 대부분 빈 칸이라 축만 길어진다', () => {
        setup({ hourlyData: hourly });

        // 차트에 넘어간 데이터도, 막대 하나하나(Cell)도 6..22의 17개다
        const charts = screen.getAllByTestId('bar-chart');
        expect(charts.some(c => c.getAttribute('data-count') === '17')).toBe(true);
        expect(screen.queryAllByTestId('cell')).toHaveLength(17);
    });

    it('입력이 24시간보다 짧아도 있는 만큼만 그린다', () => {
        setup({ hourlyData: hourly.slice(0, 10) }); // 0~9시 → 필터 후 6..9의 4개
        expect(screen.queryAllByTestId('cell')).toHaveLength(4);
    });
});

describe('주유·하이패스 요약', () => {
    it('기록이 있으면 차량별 막대를 그린다', () => {
        setup({
            fuelLogStats: { totalCost: 65000, totalAmount: 55, count: 3, vehicleData: [{ name: '카니발', cost: 50000 }] },
            hipassChargeStats: { totalAmount: 30000, count: 2, vehicleData: [{ name: '카니발', amount: 30000 }] },
        });

        expect(screen.queryByText('주유 기록이 없습니다')).not.toBeInTheDocument();
        expect(screen.queryByText('하이패스 충전 기록이 없습니다')).not.toBeInTheDocument();
        const keys = screen.getAllByTestId('bar').map(b => b.getAttribute('data-key'));
        expect(keys).toContain('cost');
        expect(keys).toContain('amount');
    });
});

describe('섹션 제목', () => {
    it('항상 보이는 섹션의 제목이 모두 있다', () => {
        setup();
        for (const title of ['직원별 현황', '차량별 주행거리', '사용목적별 비율', '차량별 주유비', '차량별 하이패스 충전']) {
            expect(screen.getByText(title)).toBeInTheDocument();
        }
    });
});
