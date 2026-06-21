/**
 * VehicleTimelineRow — VehicleTimelineBar의 차량 1대 행(row)
 * 차량명 라벨 + 타임라인 바(눈금/예약블록/드래그영역/오버레이) + 예약 상세 아코디언.
 * 드래그 상태/전역 이벤트/ref 저장소는 부모(VehicleTimelineBar)가 보유하고,
 * 이 컴포넌트는 표시와 콜백 위임만 담당하는 순수 컴포넌트다.
 */
import { getVehicleColor } from '../../lib/constants';
import { getPercent, minutesToTime, resolveReservationBlock } from '../../lib/timelineUtils';
import { isVehicleBlocked } from '../../lib/vehicleUtils';
import ReservationAccordion from './ReservationAccordion';
import type { DragOverlay } from '../../hooks/useTimelineDrag';
import type { Vehicle } from '../../types/vehicle';
import type { Reservation } from '../../types/reservation';

interface VehicleTimelineRowProps {
    vehicle: Vehicle;
    vRes: Reservation[];
    dynamicStart: number;
    hourLabels: number[];
    gaps: { start: number; end: number }[];
    isDragging: boolean;
    dragOverlay: DragOverlay | null;
    barRefCallback: (el: HTMLDivElement | null) => void;
    handleDragStart: (e: React.MouseEvent | React.TouchEvent, vehicleId: string, gapStart: number, gapEnd: number) => void;
    isPastDate: boolean;
    isExpanded: boolean;
    toggleExpand: (vehicleId: string) => void;
    onEdit?: (res: Reservation) => void;
    onCancel?: (resId: string) => void;
    user: { uid?: string; id?: string } | null;
    isAdmin: boolean;
    setShowForm?: (show: boolean) => void;
}

export default function VehicleTimelineRow({
    vehicle, vRes, dynamicStart, hourLabels, gaps, isDragging, dragOverlay,
    barRefCallback, handleDragStart, isPastDate, isExpanded, toggleExpand,
    onEdit, onCancel, user, isAdmin, setShowForm,
}: VehicleTimelineRowProps) {
    const isBlocked = isVehicleBlocked(vehicle.maintenance);

    const vehicleDisplayName = (vehicle.name && vehicle.name !== '이름 없음' && vehicle.name !== 'null')
        ? vehicle.name
        : (vehicle.displayName || vehicle.plateNumber || vehicle.modelName || '차량');

    return (
        <div>
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
                        <svg aria-hidden="true" className={`w-2.5 h-2.5 flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                    )}
                </button>

                {/* 타임라인 바 */}
                <div
                    ref={barRefCallback}
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

                        const { left, width } = resolveReservationBlock(r, dynamicStart);

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
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleExpand(vehicle.id); }}
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
                                role="presentation"
                            >
                                {!isDragging && (
                                    <div className="absolute inset-0 hover:bg-primary-200/40 dark:hover:bg-primary-500/20 transition-colors rounded-sm" />
                                )}
                            </div>
                        );
                    })}

                    {/* 드래그 선택 오버레이 */}
                    {isDragging && dragOverlay && (
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
            <ReservationAccordion
                reservations={vRes}
                isExpanded={isExpanded}
                onEdit={onEdit}
                onCancel={onCancel}
                user={user}
                isAdmin={isAdmin}
                setShowForm={setShowForm}
            />
        </div>
    );
}
