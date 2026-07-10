import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActionDeps } from '@/hooks/reservationCalendar/actions/types';
import type { ReservationForm } from '@/types/reservation';

// 예약 제출의 고위험 분기(검증 차단·생성 건수·오류 노출)를 handleSubmit 단위로 검증한다.
vi.mock('@/lib/firestore', () => ({
    createReservationSafe: vi.fn(() => Promise.resolve()),
    updateReservation: vi.fn(() => Promise.resolve()),
    deleteReservationGroup: vi.fn(() => Promise.resolve()),
    deleteRecurringGroup: vi.fn(() => Promise.resolve()),
    getReservationsByDateRange: vi.fn(() => Promise.resolve([])),
}));
vi.mock('@/hooks/utils/reservationUtils', () => ({
    findOverlappingReservation: vi.fn(() => null),
    findUserOverlappingReservation: vi.fn(() => null),
}));
vi.mock('@/lib/vehicleUtils', () => ({
    isVehicleRestrictedForUser: vi.fn(() => false),
}));
vi.mock('@/hooks/utils/recurringUtils', () => ({
    generateRecurringDates: vi.fn(() => []),
    generateRecurringGroupId: vi.fn(() => 'rgroup-1'),
}));
vi.mock('@/hooks/useTodayDashboard', () => ({
    invalidateDashboardCache: vi.fn(),
}));

import { handleSubmit } from '@/hooks/reservationCalendar/actions/submitActions';
import { createReservationSafe } from '@/lib/firestore';
import { findOverlappingReservation, findUserOverlappingReservation } from '@/hooks/utils/reservationUtils';
import { isVehicleRestrictedForUser } from '@/lib/vehicleUtils';
import { generateRecurringDates } from '@/hooks/utils/recurringUtils';

const fakeEvent = () => ({ preventDefault: vi.fn() }) as unknown as React.FormEvent;

function makeDeps(overrides: Partial<ActionDeps> = {}): ActionDeps {
    const form = {
        vehicleId: 'v1',
        destination: '목적지',
        purpose: '업무',
        startTime: '10:00',
        endTime: '11:00',
        ...(overrides.form ?? {}),
    } as unknown as ReservationForm;

    return {
        user: { uid: 'u1', email: 'u1@test.local' },
        userData: { organizationId: 'org1', name: '홍길동' },
        selectedDate: '2026-07-15',
        currentMonth: new Date('2026-07-01T00:00:00'),
        vehicles: [{ id: 'v1', displayName: '쏘나타', allowedUserIds: [] }] as unknown as ActionDeps['vehicles'],
        reservations: [],
        holidays: [],
        routeInfo: null,
        reservationSource: null,
        editingReservation: null,
        editingGroupId: null,
        editingRecurringGroupId: null,
        showToast: vi.fn(),
        confirm: vi.fn(() => Promise.resolve(true)),
        setSubmitting: vi.fn(),
        setReservations: vi.fn(),
        resetFormState: vi.fn(),
        setRouteInfo: vi.fn(),
        ...overrides,
        form,
    };
}

describe('handleSubmit — 예약 제출', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(findOverlappingReservation).mockReturnValue(null);
        vi.mocked(findUserOverlappingReservation).mockReturnValue(null);
        vi.mocked(isVehicleRestrictedForUser).mockReturnValue(false);
        vi.mocked(generateRecurringDates).mockReturnValue([]);
    });

    it('필수값이 누락되면 경고 토스트를 띄우고 쓰기를 하지 않는다', async () => {
        const deps = makeDeps({ form: { destination: '' } as unknown as ReservationForm });
        await handleSubmit(fakeEvent(), deps);
        expect(deps.showToast).toHaveBeenCalledWith('필수 정보를 입력해주세요.', 'warning');
        expect(createReservationSafe).not.toHaveBeenCalled();
    });

    it('차량 제한 사용자는 예약이 차단된다', async () => {
        vi.mocked(isVehicleRestrictedForUser).mockReturnValue(true);
        const deps = makeDeps();
        await handleSubmit(fakeEvent(), deps);
        expect(deps.showToast).toHaveBeenCalledWith('이 차량은 지정된 직원만 예약할 수 있습니다.', 'warning');
        expect(createReservationSafe).not.toHaveBeenCalled();
    });

    it('차량 시간 중복이면 차단된다', async () => {
        vi.mocked(findOverlappingReservation).mockReturnValue(
            { startTime: '10:00', endTime: '11:00' } as never,
        );
        const deps = makeDeps();
        await handleSubmit(fakeEvent(), deps);
        expect(createReservationSafe).not.toHaveBeenCalled();
    });

    it('사용자 시간 중복이면 차단된다', async () => {
        vi.mocked(findUserOverlappingReservation).mockReturnValue({ id: 'r9' } as never);
        const deps = makeDeps();
        await handleSubmit(fakeEvent(), deps);
        expect(deps.showToast).toHaveBeenCalledWith('같은 시간대에 2대의 차량을 예약할 수 없습니다.', 'warning');
        expect(createReservationSafe).not.toHaveBeenCalled();
    });

    it('업무시간 외 예약을 취소하면 쓰기를 하지 않는다', async () => {
        const deps = makeDeps({
            form: { vehicleId: 'v1', destination: '목적지', purpose: '업무', startTime: '19:00', endTime: '20:00' } as unknown as ReservationForm,
            confirm: vi.fn(() => Promise.resolve(false)),
        });
        await handleSubmit(fakeEvent(), deps);
        expect(deps.confirm).toHaveBeenCalledTimes(1);
        expect(createReservationSafe).not.toHaveBeenCalled();
    });

    it('단일 예약을 1건 생성한다', async () => {
        const deps = makeDeps();
        await handleSubmit(fakeEvent(), deps);
        expect(createReservationSafe).toHaveBeenCalledTimes(1);
        expect(vi.mocked(createReservationSafe).mock.calls[0][0]).toMatchObject({
            vehicleId: 'v1',
            date: '2026-07-15',
            organizationId: 'org1',
        });
        expect(deps.setSubmitting).toHaveBeenCalledWith(true);
        expect(deps.setSubmitting).toHaveBeenLastCalledWith(false);
    });

    it('다일 예약은 날짜 수만큼 생성한다', async () => {
        const deps = makeDeps({
            form: { vehicleId: 'v1', destination: '목적지', purpose: '업무', startTime: '10:00', endTime: '11:00', endDate: '2026-07-17' } as unknown as ReservationForm,
        });
        await handleSubmit(fakeEvent(), deps);
        // 15·16·17 → 3건
        expect(createReservationSafe).toHaveBeenCalledTimes(3);
    });

    it('반복 예약에서 생성 날짜가 0건이면 쓰기를 하지 않는다', async () => {
        vi.mocked(generateRecurringDates).mockReturnValue([]);
        const deps = makeDeps({
            form: { vehicleId: 'v1', destination: '목적지', purpose: '업무', startTime: '10:00', endTime: '11:00', isRecurring: true } as unknown as ReservationForm,
        });
        await handleSubmit(fakeEvent(), deps);
        expect(deps.showToast).toHaveBeenCalledWith('반복 예약할 날짜가 없습니다. 요일과 기간을 확인해주세요.', 'warning');
        expect(createReservationSafe).not.toHaveBeenCalled();
        expect(deps.setSubmitting).toHaveBeenLastCalledWith(false);
    });

    it('functions/already-exists 오류를 오류 토스트로 노출하고 setSubmitting(false)로 마감한다', async () => {
        vi.mocked(createReservationSafe).mockRejectedValueOnce(
            { code: 'functions/already-exists', message: '이미 예약된 시간입니다.' } as never,
        );
        const deps = makeDeps();
        await handleSubmit(fakeEvent(), deps);
        expect(deps.showToast).toHaveBeenCalledWith('이미 예약된 시간입니다.', 'error');
        expect(deps.setSubmitting).toHaveBeenLastCalledWith(false);
    });
});
