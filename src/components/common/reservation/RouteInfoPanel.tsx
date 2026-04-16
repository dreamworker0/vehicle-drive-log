/**
 * RouteInfoPanel - 경로 정보 표시 + 무료도로 토글
 */
import React, { useState } from 'react';

interface RouteInfoData {
    distance: number;
    duration: number;
    tollFee?: number;
    isMulti?: boolean;
    freeRoadRoute?: { distance: number; duration: number; tollFee: number };
}

interface RouteInfoPanelProps {
    routeInfo: RouteInfoData | null;
    routeLoading: boolean;
}

export default function RouteInfoPanel({ routeInfo, routeLoading }: RouteInfoPanelProps) {
    const [showFreeRoad, setShowFreeRoad] = useState(false);

    if (!routeLoading && !routeInfo) return null;

    return (
        <div className="mt-2">
            {routeLoading ? (
                <div className="flex items-center gap-2 text-xs text-surface-400 py-1">
                    <div className="w-3 h-3 spinner" />
                    경로 탐색 중...
                </div>
            ) : routeInfo && (
                <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800/40 animate-fade-in space-y-1.5">
                    <div className="flex items-center gap-3 text-xs">
                        {routeInfo.freeRoadRoute && <span className="text-[11px] font-semibold text-blue-500 dark:text-blue-400 bg-blue-100 dark:bg-blue-800/40 px-1.5 py-0.5 rounded">고속</span>}
                        <span className="font-bold text-blue-700 dark:text-blue-300">🗺️ {routeInfo.isMulti ? '총 ' : ''}{Math.floor(routeInfo.distance)}km</span>
                        <span className="font-bold text-blue-700 dark:text-blue-300">⏱ {routeInfo.isMulti ? '총 ' : ''}{routeInfo.duration}분</span>
                        {(routeInfo.tollFee ?? 0) > 0 && (
                            <span className="text-blue-600 dark:text-blue-400">₩{(routeInfo.tollFee ?? 0).toLocaleString()}</span>
                        )}
                        {routeInfo.freeRoadRoute && (
                            <button
                                type="button"
                                onClick={() => setShowFreeRoad(prev => !prev)}
                                className="ml-auto flex-shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-blue-100 dark:hover:bg-blue-800/40 transition-colors"
                                title="무료도로 경로 보기"
                            >
                                <svg className={`w-3.5 h-3.5 text-blue-500 dark:text-blue-400 transition-transform duration-200 ${showFreeRoad ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                            </button>
                        )}
                    </div>
                    {showFreeRoad && routeInfo.freeRoadRoute && (
                        <div className="flex items-center gap-3 text-xs border-t border-blue-200/50 dark:border-blue-800/30 pt-1.5 animate-fade-in">
                            <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-800/40 px-1.5 py-0.5 rounded">무료</span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-300">🗺️ {Math.floor(routeInfo.freeRoadRoute.distance)}km</span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-300">⏱ {routeInfo.freeRoadRoute.duration}분</span>
                            {routeInfo.freeRoadRoute.tollFee > 0 && (
                                <span className="text-emerald-600 dark:text-emerald-400">₩{routeInfo.freeRoadRoute.tollFee.toLocaleString()}</span>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
