import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// useTimelineDrag는 DOM 접근이 필요하므로 핵심 로직만 테스트
vi.mock('../../lib/timelineUtils', () => ({
    SNAP_MINUTES: 30,
    RANGE_START: 420,
    RANGE_END: 1320,
    timeToMinutes: (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    },
    minutesToTime: (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
    snapMinutes: (m: number) => Math.round(m / 30) * 30,
    getPercent: (m: number) => ((m - 420) / (1320 - 420)) * 100,
    getGaps: () => [],
    getHourLabels: () => [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
}));

import useTimelineDrag from '../../hooks/useTimelineDrag';

describe('useTimelineDrag', () => {
    it('초기 상태에서 dragState는 null이다', () => {
        const onSlotClick = vi.fn();
        const { result } = renderHook(() => useTimelineDrag(onSlotClick));

        expect(result.current.dragState).toBeNull();
    });

    it('barRefs가 MutableRefObject이다', () => {
        const onSlotClick = vi.fn();
        const { result } = renderHook(() => useTimelineDrag(onSlotClick));

        expect(result.current.barRefs.current).toEqual({});
    });

    it('getDragOverlay는 dragState가 null이면 null을 반환한다', () => {
        const onSlotClick = vi.fn();
        const { result } = renderHook(() => useTimelineDrag(onSlotClick));

        expect(result.current.getDragOverlay()).toBeNull();
    });

    it('handleDragStart/Move/End 함수가 존재한다', () => {
        const onSlotClick = vi.fn();
        const { result } = renderHook(() => useTimelineDrag(onSlotClick));

        expect(typeof result.current.handleDragStart).toBe('function');
        expect(typeof result.current.handleDragMove).toBe('function');
        expect(typeof result.current.handleDragEnd).toBe('function');
    });
});
