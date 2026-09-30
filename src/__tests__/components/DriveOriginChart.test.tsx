/**
 * DriveOriginChart.test.tsx
 * - 운행 방식(사전 예약 · 바로 운행 · 예약 없이 기록) 요약 비율과 '구분 전' 안내
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type React from 'react';

vi.mock('recharts', () => {
    const box = (name: string) => ({ children }: { children?: React.ReactNode }) => <div data-testid={name}>{children}</div>;
    return {
        ResponsiveContainer: box('responsive'), BarChart: box('bar-chart'), Bar: box('bar'),
        XAxis: box('x-axis'), YAxis: box('y-axis'), CartesianGrid: box('grid'), Tooltip: box('tooltip'),
    };
});

import DriveOriginChart from '../../components/admin/DriveOriginChart';

describe('DriveOriginChart', () => {
    it('데이터가 없으면 안내 문구만 보여 준다', () => {
        render(<DriveOriginChart data={[{ label: '10월', reservation: 0, quick: 0, manual: 0, linked: 0 }]} />);
        expect(screen.getByText('데이터가 없습니다')).toBeInTheDocument();
        expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    });

    it('기간 합계를 비율로 글자와 함께 보여 준다 — 색만으로 읽히지 않게', () => {
        render(<DriveOriginChart data={[
            { label: '9월', reservation: 2, quick: 5, manual: 1, linked: 0 },
            { label: '10월', reservation: 2, quick: 5, manual: 5, linked: 0 },
        ]} />);
        // 20건 중 사전 예약 4 · 바로 운행 10 · 예약 없이 6
        expect(screen.getByText('20%')).toBeInTheDocument();
        expect(screen.getByText('50%')).toBeInTheDocument();
        expect(screen.getByText('30%')).toBeInTheDocument();
        expect(screen.queryByText(/구분할 수 없어요/)).not.toBeInTheDocument();
    });

    it('구분 전 일지가 있으면 이유를 적는다', () => {
        render(<DriveOriginChart data={[{ label: '9월', reservation: 0, quick: 0, manual: 3, linked: 7 }]} />);
        expect(screen.getByText('예약 연결 (구분 전)')).toBeInTheDocument();
        expect(screen.getByText(/구분할 수 없어요/)).toBeInTheDocument();
    });
});
