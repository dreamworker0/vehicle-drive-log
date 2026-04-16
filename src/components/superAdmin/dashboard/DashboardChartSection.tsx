import type { FuelStatsData, HipassStatsData, FirstEmployeeStatsData } from './dashboardUtils';
import ChartOrgTrend from './ChartOrgTrend';
import ChartDAU from './ChartDAU';
import ChartFirstEmployee from './ChartFirstEmployee';
import ChartInputMethod from './ChartInputMethod';
import ChartQuickDrive from './ChartQuickDrive';
import ChartRecommendation from './ChartRecommendation';
import ChartFavoriteDestination from './ChartFavoriteDestination';
import ChartDistribution from './ChartDistribution';
import ChartHipass from './ChartHipass';
import ChartFuelHipass from './ChartFuelHipass';
import ChartCalendarSync from './ChartCalendarSync';

interface Props {
    // 일별 기관 추이
    dailyActiveOrgStats: { date: string; active: number; inactive: number; rejected: number; deleted: number; dayActive: number; dayInactive: number; dayRejected: number; dayDeleted: number }[];
    // 활성 사용자 추이
    dailyActiveUserStats: { date: string; users: number }[];
    // 첫 직원 등록 소요시간
    firstEmployeeStats: FirstEmployeeStatsData | null;
    firstEmployeeDist: { label: string; count: number; color: string }[];
    firstEmployeeTrend: { month: string; avg: number }[];
    inputMethodStats: { date: string; ocr: number; manual: number }[];
    // 바로 운행 vs 사전 예약
    quickDriveStats: { date: string; regular: number; quick: number }[];
    quickDriveRatio: { total: number; quick: number; regular: number; rate: number };
    // 추천 예약 현황
    recommendationStats: { date: string; recommendation: number; normal: number }[];
    recommendationRatio: { total: number; recommendation: number; normal: number; rate: number };
    // 목적지 즐겨찾기 현황
    favoriteStats: { date: string; favorite: number; normal: number }[];
    favoriteRatio: { total: number; favorite: number; normal: number; rate: number };
    favoriteUserRatio: { total: number; withFavorite: number; rate: number };
    // 기관/차량 분포
    orgSizeDistribution: { label: string; count: number; color: string }[];
    fuelTypeStats: { type: string; label: string; count: number; color: string }[];
    vehicleTypeStats: { type: string; label: string; count: number; color: string }[];
    vehicleModelStats: { model: string; count: number }[];
    // 하이패스
    hipassRatio: { withHipass: number; withoutHipass: number };
    hipassTopOrgs: { name: string; count: number }[];
    // 주유/하이패스 지표
    fuelStats: FuelStatsData | null;
    hipassStats: HipassStatsData | null;
    dailyFuelCost: { date: string; cost: number }[];
    dailyHipassAmount: { date: string; amount: number }[];
    // 구글 캘린더 연동
    calendarSyncRatio: { sync: number; notSync: number };
    calendarTopOrgs: { name: string; count: number }[];
    calendarSyncOrgs: number;
}

export default function DashboardChartSection(props: Props) {
    return (
        <>
            <ChartOrgTrend dailyActiveOrgStats={props.dailyActiveOrgStats} />
            <ChartDAU dailyActiveUserStats={props.dailyActiveUserStats} />
            <ChartFirstEmployee
                firstEmployeeStats={props.firstEmployeeStats}
                firstEmployeeDist={props.firstEmployeeDist}
                firstEmployeeTrend={props.firstEmployeeTrend}
            />
            <ChartInputMethod inputMethodStats={props.inputMethodStats} />
            <ChartQuickDrive 
                quickDriveStats={props.quickDriveStats} 
                quickDriveRatio={props.quickDriveRatio} 
            />
            <ChartRecommendation 
                recommendationStats={props.recommendationStats} 
                recommendationRatio={props.recommendationRatio} 
            />
            <ChartFavoriteDestination
                favoriteStats={props.favoriteStats}
                favoriteRatio={props.favoriteRatio}
                favoriteUserRatio={props.favoriteUserRatio}
            />
            <ChartDistribution
                orgSizeDistribution={props.orgSizeDistribution}
                fuelTypeStats={props.fuelTypeStats}
                vehicleTypeStats={props.vehicleTypeStats}
                vehicleModelStats={props.vehicleModelStats}
            />
            <ChartHipass
                hipassRatio={props.hipassRatio}
                hipassTopOrgs={props.hipassTopOrgs}
            />
            <ChartCalendarSync 
                calendarSyncRatio={props.calendarSyncRatio}
                calendarTopOrgs={props.calendarTopOrgs}
                calendarSyncOrgs={props.calendarSyncOrgs}
            />
            <ChartFuelHipass
                fuelStats={props.fuelStats}
                hipassStats={props.hipassStats}
                dailyFuelCost={props.dailyFuelCost}
                dailyHipassAmount={props.dailyHipassAmount}
            />
        </>
    );
}
