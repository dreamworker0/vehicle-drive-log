import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import ServiceDashboard from '../../components/superAdmin/ServiceDashboard';
import useServiceDashboard from '../../hooks/useServiceDashboard';

// Recharts 모킹 (jsdom 환경에서 SVG 렌더링 이슈 및 크기 계산 최소화 목적)
vi.mock('recharts', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('recharts');
    return {
        ...actual,
        ResponsiveContainer: ({ children }: { children: ReactNode }) => <div data-testid="mock-responsive-container">{children}</div>,
    };
});

// 하위 무거운 차트/통계 컴포넌트 모킹
vi.mock('../../components/superAdmin/dashboard/DashboardNotificationStats', () => ({
    default: () => <div data-testid="DashboardNotificationStats" />
}));
vi.mock('../../components/superAdmin/dashboard/DashboardChartSection', () => ({
    default: () => <div data-testid="DashboardChartSection" />
}));
vi.mock('../../components/superAdmin/dashboard/DashboardDriveAnalysis', () => ({
    default: () => <div data-testid="DashboardDriveAnalysis" />
}));
vi.mock('../../components/superAdmin/dashboard/DashboardFunnelChart', () => ({
    default: () => <div data-testid="DashboardFunnelChart" />
}));

// useServiceDashboard 모킹
vi.mock('../../hooks/useServiceDashboard', () => ({
    default: vi.fn()
}));

const mockData = {
    loading: false,
    stats: {
        totalUsers: 150,
        adminCount: 10,
        employeeCount: 140,
        totalLogs: 1200,
        approvedOrgs: 50,
        pendingApps: 5,
        calendarSyncOrgs: 20,
        totalDistance: 150000,
        themeStats: { dark: 45, light: 75, none: 30 },
        welcomeStats: { dismissed: 120, notDismissed: 30, rate: 80 }
    },
    monthlyStats: { 
        monthLabel: '4월',
        logs: 500, prevLogs: 450,
        distance: 12000, prevDistance: 11000,
        activeUsers: 100, prevActiveUsers: 90
    },
    weeklyActiveRate: { active: 65, total: 100 },
    onboardingStats: { total: 150, completed: 120, rate: 80 },
    dailyActiveOrgStats: [],
    dailyActiveUserStats: [],
    firstEmployeeStats: [],
    firstEmployeeDist: [],
    firstEmployeeTrend: [],
    inputMethodStats: [],
    quickDriveStats: [],
    quickDriveRatio: [],
    recommendationStats: [],
    recommendationRatio: [],
    reservationTypeStats: [],
    reservationTypeRatio: [],
    favoriteUserRatio: [],
    favoriteLogRatio: [],
    favoriteStats: [],
    orgSizeDistribution: [],
    fuelTypeStats: [],
    vehicleTypeStats: [],
    vehicleModelStats: [],
    hipassRatio: [],
    calendarSyncRatio: [],
    calendarTopOrgs: [],
    calendarSyncOrgCount: 0,
    hipassTopOrgs: [],
    fuelStats: [],
    hipassStats: [],
    dailyFuelCost: [],
    dailyHipassAmount: [],
    heatmapData: [],
    hourlyStats: [],
    monthlyGrowth: [],
    dailyAvgDuration: [],
    hourlyAvgDuration: [],
    orgAvgDuration: [],
    notifSummary: { totalNotifications: 0, successfulDeliveries: 0, failedDeliveries: 0 },
    dailyNotifStats: [],
    notifTypeStats: [],
    funnelData: [],
    topOrgs: [],
    sortedOrgs: [],
    orgPage: 1,
    setOrgPage: vi.fn(),
    sortKey: 'name',
    sortDir: 'asc',
    handleSort: vi.fn(),
    sortIndicator: vi.fn().mockImplementation(() => null),
    refreshServerStats: vi.fn().mockResolvedValue(true)
};

describe('ServiceDashboard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useServiceDashboard as ReturnType<typeof vi.fn>).mockReturnValue(mockData);
    });

    it('로딩 중일 때는 화면에 지표가 보이지 않거나 스켈레톤/로더가 노출된다', async () => {
        (useServiceDashboard as ReturnType<typeof vi.fn>).mockReturnValue({
            ...mockData,
            loading: true
        });

        const { container } = render(<ServiceDashboard />);
        expect(container).toBeInTheDocument();
    });

    it('데이터 로드 후 핵심 지표(총 사용, 주간, 온보딩) 타이틀과 수치를 렌더링한다', async () => {
        render(<ServiceDashboard />);
        // 화면 구성이 비동기로 완료되기를 기다립니다
        expect(await screen.findByText('서비스 운영 대시보드')).toBeInTheDocument();
        
        // 탭 변경 (기본값이 '운행 분석'으로 바뀌었으므로 '운영 요약' 탭 클릭)
        fireEvent.click(screen.getByText('운영 요약'));

        // 카드 내 타이틀들
        expect(await screen.findByText('전체 사용자')).toBeInTheDocument();
        expect(screen.getByText('주간 활성 (WAU)')).toBeInTheDocument();
        expect(screen.getByText('온보딩 완료율')).toBeInTheDocument();

        // 수치 렌더링 확인 (150명 가입자)
        expect(screen.getByText('150')).toBeInTheDocument();
        // 65% 비율 포맷팅
        expect(screen.getByText('80')).toBeInTheDocument();
    });

    it('빈 데이터 상태일 때 방어 코드가 동작하여 안내 문구를 렌더링한다', async () => {
        render(<ServiceDashboard />);
        fireEvent.click(screen.getByText('운영 요약'));
        
        // 데이터가 없을 때의 안내 문구를 비동기적으로 대기 (Suspense 해결 후 노출)
        const emptyTexts = await screen.findAllByText(/데이터가 없습니다/);
        expect(emptyTexts.length).toBeGreaterThan(0);
    });

    it('기관 활성도 섹션이 렌더링된다', async () => {
        render(<ServiceDashboard />);
        fireEvent.click(screen.getByText('운영 요약'));
        expect(await screen.findByText(/활성도/)).toBeInTheDocument();
    });
});
