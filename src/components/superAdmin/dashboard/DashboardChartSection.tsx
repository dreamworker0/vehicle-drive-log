import React, { useMemo } from 'react';
import type { FuelStatsData, HipassStatsData, FirstEmployeeStatsData } from './dashboardUtils';
import ChartDAU from './ChartDAU';
import ChartInputMethod from './ChartInputMethod';
import ChartQuickDrive from './ChartQuickDrive';
import ChartReservationType from './ChartReservationType';
import ChartRecommendation from './ChartRecommendation';
import ChartFavoriteDestination from './ChartFavoriteDestination';
import ChartDistribution from './ChartDistribution';
import ChartHipass from './ChartHipass';
import ChartFuelHipass from './ChartFuelHipass';
import ChartCalendarSync from './ChartCalendarSync';

interface Props {
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
    // 예약 유형별 비율
    reservationTypeStats: { date: string; single: number; multiDay: number; recurring: number }[];
    reservationTypeRatio: { total: number; single: number; multiDay: number; recurring: number; singleRate: number; multiDayRate: number; recurringRate: number };
    // 목적지 즐겨찾기 현황
    favoriteStats: { date: string; favorite: number; normal: number }[];
    favoriteRatio: { total: number; favorite: number; normal: number; rate: number };
    favoriteUserRatio: { total: number; withFavorite: number; rate: number };
    // 기관/차량 분포
    orgSizeDistribution: { label: string; count: number; color: string }[];
    fuelTypeStats: { type: string; label: string; count: number; color: string }[];
    vehicleTypeStats: { type: string; label: string; count: number; color: string }[];
    vehicleModelStats: { model: string; count: number }[];
    vehicleModelStatsActive: { model: string; count: number }[];
    vehicleModelStatsRetired: { model: string; count: number }[];
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

function DashboardChartSection(props: Props) {
    // 각 차트 컴포넌트가 이미 React.memo를 적용하고 있으므로
    // 부모인 이 컴포넌트도 React.memo로 감싸 props 변경 없을 때 리렌더링 방지
    const content = useMemo(() => (
        <>
            <ChartDAU dailyActiveUserStats={props.dailyActiveUserStats} />

            <ChartInputMethod inputMethodStats={props.inputMethodStats} />
            <ChartQuickDrive
                quickDriveStats={props.quickDriveStats}
                quickDriveRatio={props.quickDriveRatio}
            />
            <ChartReservationType
                reservationTypeStats={props.reservationTypeStats}
                reservationTypeRatio={props.reservationTypeRatio}
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
                vehicleModelStatsActive={props.vehicleModelStatsActive}
                vehicleModelStatsRetired={props.vehicleModelStatsRetired}
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
    ), [props]);

    return content;
}

export default React.memo(DashboardChartSection);
