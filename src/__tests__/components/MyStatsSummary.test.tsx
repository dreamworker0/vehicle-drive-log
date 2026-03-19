/**
 * MyStatsSummary — 월간 운행 통계 요약 컴포넌트 테스트
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MyStatsSummary from '../../components/employee/MyStatsSummary';

// 오늘 날짜 기준 테스트 로그 생성
function makeLog(daysAgo: number, startKm: number, endKm: number) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return {
        date: d.toISOString().slice(0, 10),
        startKm,
        endKm,
    };
}

describe('MyStatsSummary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('로그가 없으면 렌더링하지 않음', () => {
        const { container } = render(<MyStatsSummary logs={[]} />);
        expect(container.innerHTML).toBe('');
    });

    it('이번 달 로그가 있으면 통계를 표시', () => {
        const logs = [
            makeLog(0, 1000, 1050), // 오늘, 50km
            makeLog(1, 950, 1000),   // 어제, 50km
        ];

        render(<MyStatsSummary logs={logs} />);

        // 운행 횟수 2
        expect(screen.getByText('2')).toBeDefined();
        // 주행거리 100
        expect(screen.getByText('100')).toBeDefined();
        // "운행 횟수" 라벨
        expect(screen.getByText('운행 횟수')).toBeDefined();
        // "주행거리(km)" 라벨
        expect(screen.getByText('주행거리(km)')).toBeDefined();
    });

    it('지난 달 로그만 있어도 렌더링됨 (이번 달 0건 표시)', () => {
        const logs = [
            { date: '2025-01-15', startKm: 100, endKm: 200 },
        ];

        render(<MyStatsSummary logs={logs} />);

        // 이번 달 0건 → 운행 횟수/주행거리/일평균 모두 "0" 표시
        const zeros = screen.getAllByText('0');
        expect(zeros.length).toBeGreaterThanOrEqual(1);
    });
});
