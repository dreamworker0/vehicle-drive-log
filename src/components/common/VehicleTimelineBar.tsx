/**
 * VehicleTimelineBar — 차량별 시간대 현황을 수평 바로 시각화
 * 예약된 시간은 색상 블록, 빈 시간은 빈 영역으로 표현
 * 빈 영역 드래그 시 시간 범위를 선택하여 예약 폼에 자동 반영
 * 예약 블록 또는 차량명 클릭 시 해당 차량의 예약 상세를 아코디언으로 펼침
 */
import React, { useMemo, useState, useEffect } from 'react';
import { getVehicleColor } from '../../lib/constants';
import {
    SNAP_MINUTES, RANGE_START, RANGE_END,
    timeToMinutes, minutesToTime, snapMinutes,
    getPercent, getGaps, getHourLabels,
} from '../../lib/timelineUtils';
import useTimelineDrag from '../../hooks/useTimelineDrag';
import { isVehicleBlocked } from '../../lib/vehicleUtils';
import type { Vehicle } from '../../types/vehicle';
import type { Reservation } from '../../types/reservation';


// hourLabels는 동적 시작점에 따라 컴포넌트 내부에서 계산

interface VehicleTimelineBarProps {
    vehicles: Vehicle[];
    reservations: Reservation[];
    onSlotClick: (vehicleId: string, startTime: string, endTime: string) => void;
    isPastDate: boolean;
    isToday: boolean;
    onEdit?: (res: Reservation) => void;
    onCancel?: (resId: string) => void;
    user: { uid?: string; id?: string } | null;
    isAdmin: boolean;
    setShowForm?: (show: boolean) => void;
}

export default function VehicleTimelineBar({
    vehicles, reservations, onSlotClick, isPastDate, isToday,
    onEdit, onCancel, user, isAdmin, setShowForm,
}: VehicleTimelineBarProps) {
    // 오늘일 때 현재 시각(분) — 1분마다 갱신
    const [nowMinutes, setNowMinutes] = useState<number>(() => {
        const now = new Date();
        return now.getHours() * 60 + now.getMinutes();
    });
    useEffect(() => {
        if (!isToday) return;
        const timer = setInterval(() => {
            const now = new Date();
            setNowMinutes(now.getHours() * 60 + now.getMinutes());
        }, 60000);
        return () => clearInterval(timer);
    }, [isToday]);

    // 오늘이면 현재 시각(30분 스냅)을 동적 시작점으로 사용
    const dynamicStart = useMemo(() => {
        if (!isToday) return RANGE_START;
        const snapped = snapMinutes(nowMinutes);
        // 최소한 RANGE_START, 최대한 RANGE_END - 60 (1시간은 보이게)
        return Math.max(RANGE_START, Math.min(snapped, RANGE_END - 60));
    }, [isToday, nowMinutes]);

    // 동적 시간 눈금
    const hourLabels = useMemo(() => getHourLabels(Math.ceil(dynamicStart / 60)), [dynamicStart]);

    // 드래그 훅 (동적 시작점 전달)
    const {
        dragState, barRefs,
        handleDragStart, handleDragMove, handleDragEnd, getDragOverlay,
    } = useTimelineDrag(onSlotClick, dynamicStart);

    // 아코디언 확장 상태
    const [expandedVehicleId, setExpandedVehicleId] = useState<string | null>(null);
    const toggleExpand = (vehicleId: string) => {
        setExpandedVehicleId(prev => prev === vehicleId ? null : vehicleId);
    };



    // 차량별 예약 데이터 그룹핑
    const vehicleData = useMemo(() => {
        return vehicles.filter(v => !v.retired?.isRetired).map(v => {
            const vRes = reservations
                .filter(r => r.vehicleId === v.id && r.status !== 'cancelled')
                .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
            return { vehicle: v, reservations: vRes };
        });
    }, [vehicles, reservations]);

    // gap 계산을 위한 스냅 현재 시각
    const nowSnapped = isToday ? snapMinutes(nowMinutes + SNAP_MINUTES - 1) : RANGE_START;

    if (vehicles.length === 0) return null;

    const dragOverlay = getDragOverlay();

    return (
        <div
            className="mb-4 animate-fade-in"
            onMouseMove={handleDragMove}
            onMouseUp={handleDragEnd}
            onMouseLeave={handleDragEnd}
            onTouchMove={handleDragMove}
            onTouchEnd={handleDragEnd}
            onTouchCancel={handleDragEnd}
        >
            <div className="flex items-center justify-between mb-2">
                <p className="text-[12px] font-semibold text-surface-600 dark:text-surface-300">
                    시간대 현황
                </p>
                {/* 범례 (상단 배치) */}
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                        <div className="w-2.5 h-2.5 rounded-sm bg-blue-200 dark:bg-blue-300/50 border border-white/30" />
                        <span className="text-[10px] text-surface-500 dark:text-surface-400">예약됨</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-2.5 h-2.5 rounded-sm bg-[repeating-linear-gradient(45deg,rgba(0,0,0,0.1),rgba(0,0,0,0.1)_2px,rgba(255,255,255,0.8)_2px,rgba(255,255,255,0.8)_4px)] dark:bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.1),rgba(255,255,255,0.1)_2px,rgba(0,0,0,0.4)_2px,rgba(0,0,0,0.4)_4px)] border border-surface-300 dark:border-surface-600" />
                        <span className="text-[10px] text-surface-500 dark:text-surface-400">승인 대기</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-2.5 h-2.5 rounded-sm bg-surface-100 dark:bg-surface-700/50 border border-surface-200 dark:border-surface-600" />
                        <span className="text-[10px] text-surface-500 dark:text-surface-400">예약 가능</span>
                    </div>
                </div>
            </div>
            <div className="rounded-xl bg-surface-50 dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700 p-3 overflow-hidden shadow-sm">
                {/* 시간 눈금 */}
                <div className="relative h-4 mb-1 ml-[72px]">
                    {hourLabels.map(h => (
                        <span
                            key={h}
                            className="absolute text-[10px] font-medium text-surface-500 dark:text-surface-400 -translate-x-1/2 select-none"
                            style={{ left: `${getPercent(h * 60, dynamicStart)}%` }}
                        >
                            {h}
                        </span>
                    ))}
                </div>

                {/* 차량별 타임라인 행 */}
                <div className="space-y-1.5">
                    {vehicleData.map(({ vehicle, reservations: vRes }) => {
                        const isBlocked = isVehicleBlocked(vehicle.maintenance);
                        const gaps = getGaps(vRes, isToday, nowSnapped);
                        const isDraggingThis = dragState?.vehicleId === vehicle.id;
                        const isExpanded = expandedVehicleId === vehicle.id;

                        const vehicleDisplayName = vehicle.name || (vehicle as unknown as { displayName?: string }).displayName || '차량';

                        return (
                            <div key={vehicle.id}>
                                <div className="flex items-center gap-2">
                                    {/* 차량명 라벨 */}
                                    <button
                                        type="button"
                                        onClick={() => vRes.length > 0 && toggleExpand(vehicle.id)}
                                        className={`w-[64px] text-[10px] font-medium truncate flex-shrink-0 text-right flex items-center justify-end gap-0.5 border-0 bg-transparent p-0 ${isBlocked
                                            ? 'text-surface-400 line-through cursor-default'
                                            : vRes.length > 0
                                                ? 'text-surface-700 dark:text-surface-300 cursor-pointer hover:text-primary-500 dark:hover:text-primary-400'
                                                : 'text-surface-700 dark:text-surface-300 cursor-default'
                                            }`}
                                        title={vehicleDisplayName}
                                    >
                                        {isBlocked ? '🔧 ' : ''}{vehicleDisplayName}
                                        {vRes.length > 0 && (
                                            <svg className={`w-2.5 h-2.5 flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                            </svg>
                                        )}
                                    </button>

                                    {/* 타임라인 바 */}
                                    <div
                                        ref={el => { barRefs.current[vehicle.id] = el; }}
                                        className="relative flex-1 h-6 rounded bg-surface-100 dark:bg-surface-700/50 overflow-hidden select-none"
                                        style={{ touchAction: 'none' }}
                                    >
                                        {/* 시간 눈금선 */}
                                        {hourLabels.map(h => (
                                            <div
                                                key={h}
                                                className="absolute top-0 bottom-0 w-px bg-surface-200/60 dark:bg-surface-600/40"
                                                style={{ left: `${getPercent(h * 60, dynamicStart)}%` }}
                                            />
                                        ))}

                                        {/* 예약 블록 — 타임라인 렌더 범위(06:00~23:00) 밖이더라도 최소한 클리핑해서 표시 */}
                                        {vRes.map(r => {
                                            const isCompleted = r.status === 'completed';
                                            const isPending = r.status === 'pending';
                                            const effStart = (isCompleted && r.actualStartTime) ? r.actualStartTime : (r.startTime || '');
                                            const effEnd = (isCompleted && r.actualEndTime) ? r.actualEndTime : (r.endTime || '');
                                            const rStartMin = timeToMinutes(effStart);
                                            const rEndMin = timeToMinutes(effEnd);
                                            
                                            const clampedStartMin = Math.max(rStartMin, dynamicStart);
                                            const clampedEndMin = Math.max(rEndMin, dynamicStart);
                                            
                                            let left = getPercent(clampedStartMin, dynamicStart);
                                            let right = getPercent(clampedEndMin, dynamicStart);
                                            
                                            if (left > right) {
                                                const temp = left; left = right; right = temp;
                                            }
                                            
                                            if (Number.isNaN(left)) left = 0;
                                            if (Number.isNaN(right)) right = left + 1.5;
                                            
                                            let width = right - left;
                                            
                                            // 1% 미만의 아주 짧은 예약이거나 시야범위 밖 예약이더라도
                                            // 사용자가 시각적으로 최소한의 블록을 클릭/인식할 수 있게 1.5% 보장
                                            if (width < 1.5 || Number.isNaN(width)) {
                                                width = 1.5;
                                                if (left + width > 100) left = 100 - width;
                                            }
                                            
                                            const colorClass = getVehicleColor(vehicle.id);
                                            const bgClass = isPending
                                                ? `${colorClass} ${colorClass.replace('bg-', 'text-')}/20 bg-[repeating-linear-gradient(45deg,currentColor,currentColor_2px,transparent_2px,transparent_6px)] opacity-90`
                                                : `${colorClass} ${isCompleted ? 'opacity-60 dark:opacity-40' : 'opacity-80 dark:opacity-60'}`;

                                            return (
                                                <div
                                                    key={r.id}
                                                    className={`absolute top-0.5 bottom-0.5 rounded-sm ${bgClass} border border-white/40 dark:border-surface-500/30 cursor-pointer hover:opacity-100 dark:hover:opacity-80 transition-opacity`}
                                                    style={{ left: `${left}%`, width: `${width}%` }}
                                                    title={`${r.reservedByName}: ${r.startTime}~${r.endTime} ${r.purpose || ''}${isCompleted ? ' (운행완료)' : isPending ? ' (승인 대기)' : ''}`}
                                                    onClick={() => toggleExpand(vehicle.id)}
                                                />
                                            );
                                        })}

                                        {/* 빈 시간 드래그 영역 */}
                                        {!isPastDate && !isBlocked && gaps.map((gap, gi) => {
                                            const left = getPercent(gap.start, dynamicStart);
                                            const right = getPercent(gap.end, dynamicStart);
                                            const width = right - left;
                                            if (gap.end - gap.start < 5) return null;
                                            return (
                                                <div
                                                    key={gi}
                                                    className="absolute top-0 bottom-0 cursor-pointer"
                                                    style={{ left: `${left}%`, width: `${width}%` }}
                                                    title={`${minutesToTime(gap.start)}~${minutesToTime(gap.end)} 예약 가능 (드래그로 선택)`}
                                                    onMouseDown={(e) => handleDragStart(e, vehicle.id, gap.start, gap.end)}
                                                    onTouchStart={(e) => handleDragStart(e, vehicle.id, gap.start, gap.end)}
                                                >
                                                    {!isDraggingThis && (
                                                        <div className="absolute inset-0 hover:bg-primary-200/40 dark:hover:bg-primary-500/20 transition-colors rounded-sm" />
                                                    )}
                                                </div>
                                            );
                                        })}

                                        {/* 드래그 선택 오버레이 */}
                                        {isDraggingThis && dragOverlay && (
                                            <>
                                                <div
                                                    className="absolute top-0 bottom-0 bg-primary-400/40 dark:bg-primary-500/30 border border-primary-500/60 dark:border-primary-400/50 rounded-sm z-10 pointer-events-none transition-[left,width] duration-75"
                                                    style={{
                                                        left: `${dragOverlay.left}%`,
                                                        width: `${Math.max(dragOverlay.width, 0.5)}%`,
                                                    }}
                                                />
                                                {dragOverlay.width > 3 && (
                                                    <div
                                                        className="absolute -top-5 z-20 pointer-events-none text-[9px] font-bold text-primary-600 dark:text-primary-300 whitespace-nowrap bg-white/90 dark:bg-surface-800/90 px-1 rounded shadow-sm"
                                                        style={{
                                                            left: `${dragOverlay.left + dragOverlay.width / 2}%`,
                                                            transform: 'translateX(-50%)',
                                                        }}
                                                    >
                                                        {minutesToTime(dragOverlay.selStart)}~{minutesToTime(dragOverlay.selEnd)}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* 아코디언: 해당 차량 예약 상세 */}
                                {isExpanded && vRes.length > 0 && (
                                    <div className="ml-[72px] pl-2 mt-1 mb-1 border-l-2 border-primary-300 dark:border-primary-700 animate-fade-in">
                                        {vRes.map(r => {
                                            const resEndDateTime = new Date(`${r.date}T${r.endTime || '23:59'}`);
                                            const isPastReservation = resEndDateTime < new Date();
                                            return (
                                                <div key={r.id} className="py-1.5 first:pt-0.5 last:pb-0.5">
                                                    <div className="flex items-center justify-between gap-1">
                                                        <div className="text-[11px] text-surface-600 dark:text-surface-300 truncate">
                                                            <span className="font-medium">{r.reservedByName}</span>
                                                            <span className="mx-1 text-surface-300 dark:text-surface-600">|</span>
                                                            {r.startTime} ~ {r.endTime}
                                                            {r.destination && <span className="mx-1 text-surface-300 dark:text-surface-600">|</span>}
                                                            {r.destination && <span>{r.destination}</span>}
                                                            {r.purpose && <span>, {r.purpose}</span>}
                                                            {r.groupId && <span className="ml-1 text-blue-500" title="다일 예약">🔗</span>}
                                                        </div>
                                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                                            {(r as unknown as { syncSource?: string }).syncSource === 'calendar' && (
                                                                <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300 rounded-full font-medium">
                                                                    📅
                                                                </span>
                                                            )}
                                                            {r.status === 'pending' && (
                                                                <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 rounded-full font-medium whitespace-nowrap">
                                                                    승인 대기
                                                                </span>
                                                            )}
                                                            {(isAdmin || r.reservedByUid === user?.id || r.reservedByUid === user?.uid) && !isPastReservation && (
                                                                <>
                                                                    <button onClick={() => { onEdit?.(r); setShowForm?.(true); }} className="text-[11px] leading-none py-0.5 text-primary-500 hover:underline">수정</button>
                                                                    <button onClick={() => onCancel?.(r.id)} className="text-[11px] leading-none py-0.5 text-red-500 hover:underline">취소</button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {(r as unknown as { routeDistance?: number }).routeDistance && (
                                                        <p className="text-[11px] text-blue-500 mt-0.5 flex items-center gap-2">
                                                            <span>🗺️ {Math.floor((r as unknown as { routeDistance: number }).routeDistance)}km</span>
                                                            <span>⏱ {(r as unknown as { routeDuration?: number }).routeDuration}분</span>
                                                            {((r as unknown as { routeTollFee?: number }).routeTollFee ?? 0) > 0 && <span>₩{(r as unknown as { routeTollFee: number }).routeTollFee.toLocaleString()}</span>}
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* 조작 안내 팁 */}
                <div className="mt-2 text-right">
                    <span className="text-[10px] text-surface-400 whitespace-nowrap">
                        {!isPastDate && '시간을 드래그하여 예약 · '}차량을 터치하여 상세 확인
                    </span>
                </div>
            </div>
        </div>
    );
}
