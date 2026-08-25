/**
 * RouteInfoPanel - 경로 정보 표시 + 무료도로 토글 (on-demand)
 */
import React, { useState } from 'react';

interface RouteInfoData {
    distance: number;
    duration: number;
    tollFee?: number;
    hasToll?: boolean;
    isMulti?: boolean;
}

interface RouteInfoPanelProps {
    routeInfo: RouteInfoData | null;
    routeLoading: boolean;
    freeRoadRoute?: { distance: number; duration: number; tollFee: number } | null;
    freeRoadLoading?: boolean;
    onFetchFreeRoad?: () => void;
    /**
     * 출발지 이름(분관을 등록한 기관에서만 들어온다). 어느 주소를 기준으로 계산한 거리인지
     * 보이지 않으면, 분관 차량인데 값이 이상하다는 신고가 들어와도 원인을 알 수 없다.
     */
    departureSiteName?: string;
}

export default function RouteInfoPanel({
    routeInfo,
    routeLoading,
    freeRoadRoute,
    freeRoadLoading = false,
    onFetchFreeRoad,
    departureSiteName = '',
}: RouteInfoPanelProps) {
    const [showFreeRoad, setShowFreeRoad] = useState(false);

    if (!routeLoading && !routeInfo) return null;

    const handleToggleFreeRoad = () => {
        const next = !showFreeRoad;
        setShowFreeRoad(next);
        // 처음 펼칠 때 && 아직 데이터 없으면 on-demand 호출
        if (next && !freeRoadRoute && !freeRoadLoading && onFetchFreeRoad) {
            onFetchFreeRoad();
        }
    };

    return (
        <div className="mt-2">
            {routeLoading ? (
                <div className="flex items-center gap-2 text-xs text-surface-400 dark:text-surface-500 py-1">
                    <div className="w-3 h-3 spinner" />
                    경로 탐색 중...
                </div>
            ) : routeInfo && (
                <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800/40 animate-fade-in space-y-1.5">
                    {/* 좁은 화면·큰 글씨 설정에서는 한 줄에 다 들어가지 않는다. 줄바꿈을 허용하고
                        각 값은 nowrap으로 묶어, 글자가 한 자씩 세로로 쪼개지지 않게 한다. */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                        {departureSiteName && (
                            /* 분관 이름은 길 수 있다 — 쪼개지 않고 말줄임으로 넘긴다 */
                            <span className="text-[11px] font-semibold text-surface-500 dark:text-surface-400 bg-surface-100 dark:bg-surface-700 px-1.5 py-0.5 rounded min-w-0 max-w-full truncate">
                                🚩 {departureSiteName} 출발
                            </span>
                        )}
                        {routeInfo.hasToll && <span className="text-[11px] font-semibold text-blue-500 dark:text-blue-400 bg-blue-100 dark:bg-blue-800/40 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">고속</span>}
                        <span className="font-bold text-blue-700 dark:text-blue-300 whitespace-nowrap shrink-0">🗺️ {routeInfo.isMulti ? '총 ' : ''}{Math.floor(routeInfo.distance)}km</span>
                        <span className="font-bold text-blue-700 dark:text-blue-300 whitespace-nowrap shrink-0">⏱ {routeInfo.isMulti ? '총 ' : ''}{routeInfo.duration}분</span>
                        {(routeInfo.tollFee ?? 0) > 0 && (
                            <span className="text-blue-600 dark:text-blue-400 whitespace-nowrap shrink-0">₩{(routeInfo.tollFee ?? 0).toLocaleString()}</span>
                        )}
                        {/* 통행료 있을 때만 펼치기 버튼 표시 */}
                        {routeInfo.hasToll && onFetchFreeRoad && (
                            <button
                                type="button"
                                onClick={handleToggleFreeRoad}
                                className="ml-auto flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-blue-100 dark:hover:bg-blue-800/40 transition-colors"
                                title="무료도로 경로 보기"
                            >
                                {freeRoadLoading && showFreeRoad
                                    ? <div className="w-3 h-3 spinner" />
                                    : <svg className={`w-3.5 h-3.5 text-blue-500 dark:text-blue-400 transition-transform duration-200 ${showFreeRoad ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                                }
                            </button>
                        )}
                    </div>
                    {showFreeRoad && freeRoadRoute && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs border-t border-blue-200/50 dark:border-blue-800/30 pt-1.5 animate-fade-in">
                            <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-800/40 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">무료</span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-300 whitespace-nowrap shrink-0">🗺️ {Math.floor(freeRoadRoute.distance)}km</span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-300 whitespace-nowrap shrink-0">⏱ {freeRoadRoute.duration}분</span>
                            {freeRoadRoute.tollFee > 0 && (
                                <span className="text-emerald-600 dark:text-emerald-400 whitespace-nowrap shrink-0">₩{freeRoadRoute.tollFee.toLocaleString()}</span>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
