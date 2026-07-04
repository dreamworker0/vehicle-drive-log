/**
 * VehicleTimelineBar — 차량별 시간대 현황을 수평 바로 시각화
 * 예약된 시간은 색상 블록, 빈 시간은 빈 영역으로 표현
 * 빈 영역 드래그 시 시간 범위를 선택하여 예약 폼에 자동 반영
 * 예약 블록 또는 차량명 클릭 시 해당 차량의 예약 상세를 아코디언으로 펼침
 */
import { useMemo, useState, useEffect } from 'react';
import {
    SNAP_MINUTES, RANGE_START, RANGE_END,
    snapMinutes, getPercent, getGaps, getHourLabels,
} from '../../lib/timelineUtils';
import useTimelineDrag from '../../hooks/useTimelineDrag';
import { isVehicleRestrictedForUser } from '../../lib/vehicleUtils';
import VehicleTimelineRow from './VehicleTimelineRow';
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



    // 차량별 예약 데이터 그룹핑 (사용 제한 차량은 맨 아래로, 상위 정렬 순서는 유지)
    const vehicleData = useMemo(() => {
        const active = vehicles.filter(v => !v.retired?.isRetired);
        const ordered = [
            ...active.filter(v => !isVehicleRestrictedForUser(v, user?.uid)),
            ...active.filter(v => isVehicleRestrictedForUser(v, user?.uid)),
        ];
        return ordered.map(v => {
            const vRes = reservations
                .filter(r => r.vehicleId === v.id && r.status !== 'cancelled')
                .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
            return { vehicle: v, reservations: vRes };
        });
    }, [vehicles, reservations, user?.uid]);

    // gap 계산을 위한 스냅 현재 시각
    const nowSnapped = isToday ? snapMinutes(nowMinutes + SNAP_MINUTES - 1) : RANGE_START;

    if (vehicles.length === 0) return null;

    const dragOverlay = getDragOverlay();

    return (
        <div
            className="mb-4 animate-fade-in"
            role="presentation"
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
                    {vehicleData.map(({ vehicle, reservations: vRes }) => (
                        <VehicleTimelineRow
                            key={vehicle.id}
                            vehicle={vehicle}
                            vRes={vRes}
                            dynamicStart={dynamicStart}
                            hourLabels={hourLabels}
                            gaps={getGaps(vRes, isToday, nowSnapped)}
                            isDragging={dragState?.vehicleId === vehicle.id}
                            dragOverlay={dragOverlay}
                            barRefCallback={el => { barRefs.current[vehicle.id] = el; }}
                            handleDragStart={handleDragStart}
                            isPastDate={isPastDate}
                            isExpanded={expandedVehicleId === vehicle.id}
                            toggleExpand={toggleExpand}
                            onEdit={onEdit}
                            onCancel={onCancel}
                            user={user}
                            isAdmin={isAdmin}
                            setShowForm={setShowForm}
                        />
                    ))}
                </div>

                {/* 조작 안내 팁 */}
                <div className="mt-2 text-right">
                    <span className="text-[10px] text-surface-400 dark:text-surface-500 whitespace-nowrap">
                        {!isPastDate && '시간을 드래그하여 예약 · '}차량을 터치하여 상세 확인
                    </span>
                </div>
            </div>
        </div>
    );
}
