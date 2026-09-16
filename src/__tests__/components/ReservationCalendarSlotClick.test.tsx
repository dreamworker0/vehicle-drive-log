/**
 * 타임라인에서 **드래그로 그린 구간**이 종료시간 잠금을 거는지 고정한다.
 *
 * 머지 전 리뷰가 잡은 자리다 — 수정 화면만 잠그고 이 경로를 열어 둬, 드래그로 14:00~15:00을
 * 그려 넣어도 1.2초 뒤 경로 계산이 종료시간을 덮었다. 그 구간은 `useTimelineDrag`가
 * **다음 예약 직전까지로 잘라서** 넘기므로, 덮인 값은 남의 예약을 침범하는 시간이 되어
 * 제출 자체가 거부된다(신고 ①의 정황과 맞는 경로다).
 *
 * 잠금은 `handleSlotClick` 한 줄이라 조용히 되돌아가기 쉽다. 훅과 자식 UI는 전부 대역으로
 * 두고 **배선만** 본다 — 캘린더 전체를 실제로 띄우면 이 한 줄에 비해 비용이 너무 크다.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const setForm = vi.fn();
const setShowForm = vi.fn();
const setEndTimeTouched = vi.fn();

/** 사이드 패널 대역 — onSlotClick만 눌러 볼 수 있게 내놓는다 */
vi.mock('../../components/common/ReservationSidePanel', () => ({
    default: ({ onSlotClick }: { onSlotClick: (v: string, s: string, e: string) => void }) => (
        <button onClick={() => onSlotClick('v1', '14:00', '15:00')}>구간 드래그</button>
    ),
}));
vi.mock('../../components/common/CalendarGrid', () => ({ default: () => <div /> }));
vi.mock('../../components/admin/PendingReservationList', () => ({ default: () => <div /> }));

vi.mock('../../hooks/useVehiclePriority', () => ({ default: () => ({ usageCounts: {} }) }));
vi.mock('../../hooks/useReservationPattern', () => ({
    useReservationPattern: () => ({ recentDestinations: [] }),
}));

vi.mock('../../hooks/useReservationCalendar', () => ({
    default: () => ({
        vehicles: [], loading: false, reservations: [], favorites: [], members: [],
        form: { vehicleId: '', destination: '', purpose: '', startTime: '', endTime: '' },
        setForm, setShowForm, setEndTimeTouched,
        selectedDate: '2026-09-16', showForm: true, sideTab: 'list', setSideTab: vi.fn(),
        submitting: false, editingReservation: null, editingGroupId: null, editingRecurringGroupId: null,
        routeInfo: null, routeLoading: false, suggestedEndTime: null, endTimeTouched: false,
        freeRoadRoute: null, freeRoadLoading: false, handleFetchFreeRoad: vi.fn(), departureSiteName: '',
        showFavSave: false, setShowFavSave: vi.fn(), favName: '', setFavName: vi.fn(),
        calendarDays: [], monthLabel: '2026년 9월', todayStr: '2026-09-16',
        selectedReservations: [], isPastDate: false, isToday: true,
        user: { uid: 'u1' }, reservationPassengerOn: false, orgFeatures: { googleCalendar: false },
        prevMonth: vi.fn(), nextMonth: vi.fn(), handleDateSelect: vi.fn(),
        handleSubmit: vi.fn(), handleEdit: vi.fn(), handleCancel: vi.fn(),
        handleSaveFavorite: vi.fn(), handleOpenForm: vi.fn(),
        getCurrentTimeStr: () => '13:45', getMinStartTime: () => '00:00',
        getNavigationDeeplink: () => '', holidays: [],
        syncNow: vi.fn(), syncing: false, lastSyncAt: null,
    }),
}));

import ReservationCalendar from '../../components/common/ReservationCalendar';

describe('타임라인 드래그 구간', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('드래그로 그린 구간은 종료시간을 잠근다 — 경로 계산이 덮으면 남의 예약을 침범한다', () => {
        render(<ReservationCalendar />);

        fireEvent.click(screen.getByText('구간 드래그'));

        expect(setEndTimeTouched).toHaveBeenCalledWith(true);
    });

    it('그린 구간을 폼에 그대로 싣고 폼을 연다', () => {
        render(<ReservationCalendar />);

        fireEvent.click(screen.getByText('구간 드래그'));

        const updater = setForm.mock.calls[0][0] as (prev: Record<string, unknown>) => Record<string, unknown>;
        expect(updater({})).toMatchObject({ vehicleId: 'v1', startTime: '14:00', endTime: '15:00' });
        expect(setShowForm).toHaveBeenCalledWith(true);
    });
});
