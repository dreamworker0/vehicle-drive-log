/**
 * useTimelineDrag — 차량 타임라인 바의 드래그 상태 및 이벤트 관리 훅
 */
import { useState, useRef, useCallback } from 'react';
import {
    snapMinutes, minutesToTime, getPercent,
    RANGE_START, RANGE_END, SNAP_MINUTES,
} from '../lib/timelineUtils';

interface DragState {
    vehicleId: string;
    gapStart: number;
    gapEnd: number;
    startMin: number;
    currentMin: number;
}

/**
 * 타임라인 바 드래그 선택 훅
 * @param {Function} onSlotClick - 슬롯 선택 콜백 (vehicleId, startTime, endTime)
 * @param {number} [dynamicStart] - 동적 시작점(분). 오늘 모드에서 현재 시각 기준으로 사용
 * @returns {object} 드래그 관련 상태 및 핸들러
 */
export default function useTimelineDrag(onSlotClick?: (vehicleId: string, startTime: string, endTime: string) => void, dynamicStart?: number) {
    const rangeStart = dynamicStart ?? RANGE_START;
    const totalMinutes = RANGE_END - rangeStart;
    // 드래그 상태: { vehicleId, gapStart, gapEnd, startMin, currentMin }
    const [dragState, setDragState] = useState<DragState | null>(null);
    // 각 차량 바의 DOM 참조 (vehicleId -> ref)
    const barRefs = useRef<Record<string, HTMLDivElement | null>>({});

    // 클라이언트 X 좌표를 분 단위로 변환 (바 DOM 기준)
    const clientXToMinutes = useCallback((clientX: number, vehicleId: string) => {
        const bar = (barRefs.current as Record<string, HTMLDivElement | null>)[vehicleId];
        if (!bar) return rangeStart;
        const rect = bar.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return snapMinutes(rangeStart + ratio * totalMinutes);
    }, [rangeStart, totalMinutes]);

    const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent, vehicleId: string, gapStart: number, gapEnd: number) => {
        e.preventDefault();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const min = clientXToMinutes(clientX, vehicleId);
        const clampedMin = Math.max(gapStart, Math.min(gapEnd, min));

        setDragState({
            vehicleId,
            gapStart,
            gapEnd,
            startMin: clampedMin,
            currentMin: clampedMin,
        });
    }, [clientXToMinutes]);

    const handleDragMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        if (!dragState) return;
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const min = clientXToMinutes(clientX, dragState.vehicleId);
        const clampedMin = Math.max(dragState.gapStart, Math.min(dragState.gapEnd, min));

        setDragState((prev) => prev ? { ...prev, currentMin: clampedMin } : null);
    }, [dragState, clientXToMinutes]);

    const handleDragEnd = useCallback(() => {
        if (!dragState) return;

        const selStart = Math.min(dragState.startMin, dragState.currentMin);
        const selEnd = Math.max(dragState.startMin, dragState.currentMin);
        const duration = selEnd - selStart;

        if (duration < SNAP_MINUTES) {
            const clickStart = snapMinutes(dragState.startMin);
            const clickEnd = Math.min(clickStart + 60, dragState.gapEnd);
            onSlotClick?.(dragState.vehicleId, minutesToTime(clickStart), minutesToTime(clickEnd));
        } else {
            onSlotClick?.(dragState.vehicleId, minutesToTime(selStart), minutesToTime(selEnd));
        }

        setDragState(null);
    }, [dragState, onSlotClick]);

    // 드래그 중 선택 영역 계산
    const getDragOverlay = useCallback(() => {
        if (!dragState) return null;
        const selStart = Math.min(dragState.startMin, dragState.currentMin);
        const selEnd = Math.max(dragState.startMin, dragState.currentMin);
        const left = getPercent(selStart, rangeStart);
        const width = getPercent(selEnd, rangeStart) - left;
        return { left, width, selStart, selEnd };
    }, [dragState, rangeStart]);

    return {
        dragState,
        barRefs,
        handleDragStart,
        handleDragMove,
        handleDragEnd,
        getDragOverlay,
    };
}
