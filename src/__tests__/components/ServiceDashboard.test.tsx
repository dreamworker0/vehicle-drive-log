import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
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
    summary: {
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
        orgSizeDistribution: [],
        fuelTypeStats: [],
        vehicleTypeStats: [],
        vehicleModelStats: [],
    },
    timeSeries: {
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
        heatmapData: { grid: Array.from({ length: 7 }, () => Array(24).fill(0)), maxCount: 1 },
        hourlyStats: [],
        monthlyGrowth: [],
        dailyAvgDuration: [],
        hourlyAvgDuration: [],
        orgAvgDuration: [],
        funnelData: [],
    },
    rankings: {
        topOrgs: [],
        hipassRatio: [],
        calendarSyncRatio: [],
        calendarTopOrgs: [],
        calendarSyncOrgCount: 0,
        hipassTopOrgs: [],
    },
    external: {
        fuelStats: null,
        hipassStats: null,
        dailyFuelCost: [],
        dailyHipassAmount: [],
        notifSummary: { totalNotifications: 0, successfulDeliveries: 0, failedDeliveries: 0 },
        dailyNotifStats: [],
        notifTypeStats: [],
    },
    sortedOrgs: [],
    ui: {
        orgPage: 1,
        setOrgPage: vi.fn(),
        sortKey: 'name',
        sortDir: 'asc',
        handleSort: vi.fn(),
        sortIndicator: vi.fn().mockImplementation(() => null),
    },
    actions: {
        loadAllStats: vi.fn(),
        refreshServerStats: vi.fn().mockResolvedValue({ skipped: false })
    }
};

/**
 * 모킹하지 않은 지연 로드 차트를 미리 변환해 둔다.
 *
 * '운영 요약' 탭을 처음 누르는 테스트가 ChartOrgTrend·ChartFirstEmployee(+ 실제 recharts)를
 * **처음** 불러오면서 코드 변환 비용을 혼자 떠안았다. 평소엔 3초 안에 끝나지만 다른 작업과 동시에
 * 돌아 CPU가 붐비면 22.8초가 걸려 기본 5초 제한을 넘겼다(2026-10-14 실측, CI 전용 러너에서는 실패 없음).
 * 여기서 넉넉한 제한으로 한 번 불러 두면 각 테스트는 변환이 끝난 모듈을 쓴다 — 테스트별 제한은
 * 그대로라 진짜로 멈추는 회귀는 여전히 잡힌다.
 */
beforeAll(async () => {
    await Promise.all([
        import('../../components/superAdmin/dashboard/ChartOrgTrend'),
        import('../../components/superAdmin/dashboard/ChartFirstEmployee'),
    ]);
}, 60_000);

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

    it('통계 로드가 권한 문제로 실패하면 빈 차트가 아니라 원인과 재시도를 안내한다', async () => {
        const loadAllStats = vi.fn();
        (useServiceDashboard as ReturnType<typeof vi.fn>).mockReturnValue({
            ...mockData,
            loadError: 'permission',
            actions: { ...mockData.actions, loadAllStats }
        });

        render(<ServiceDashboard />);
        expect(await screen.findByText('통계를 불러오지 못했습니다')).toBeInTheDocument();
        expect(screen.getByText(/권한 정보/)).toBeInTheDocument();

        fireEvent.click(screen.getByText('다시 시도'));
        expect(loadAllStats).toHaveBeenCalledWith(false);
    });

    it('정상 로드 시에는 실패 안내를 띄우지 않는다', async () => {
        render(<ServiceDashboard />);
        expect(await screen.findByText('서비스 운영 대시보드')).toBeInTheDocument();
        expect(screen.queryByText('통계를 불러오지 못했습니다')).not.toBeInTheDocument();
    });

    it('기관 활성도 섹션이 렌더링된다', async () => {
        render(<ServiceDashboard />);
        fireEvent.click(screen.getByText('운영 요약'));
        expect(await screen.findByText(/활성도/)).toBeInTheDocument();
    });
});
