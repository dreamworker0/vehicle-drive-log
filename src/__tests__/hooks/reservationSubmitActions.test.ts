import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActionDeps } from '@/hooks/reservationCalendar/actions/types';
import type { ReservationForm } from '@/types/reservation';

// 예약 제출의 고위험 분기(검증 차단·생성 건수·오류 노출)를 handleSubmit 단위로 검증한다.
vi.mock('@/lib/firestore', () => ({
    createReservationSafe: vi.fn(() => Promise.resolve()),
    updateReservation: vi.fn(() => Promise.resolve()),
    detachFromRecurringGroup: vi.fn(() => Promise.resolve()),
    deleteReservationGroup: vi.fn(() => Promise.resolve()),
    deleteRecurringGroup: vi.fn(() => Promise.resolve()),
    cancelRecurringGroup: vi.fn(() => Promise.resolve(3)),
    getReservationsByDateRange: vi.fn(() => Promise.resolve([])),
}));
// 날짜 구간 계산(buildMultiDaySlots)은 실제 구현을 쓴다 — 여기서 흉내 내면
// "검증과 생성이 같은 목록을 본다"는 계약 자체가 테스트에서 사라진다.
vi.mock('@/hooks/utils/reservationUtils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/hooks/utils/reservationUtils')>()),
    findOverlappingReservation: vi.fn(() => null),
    // 지난 시간 판정은 "오늘"에만 걸린다. 픽스처 날짜(2026-07-15)와 겹치지 않는 고정값을 줘서
    // 테스트가 실행 시각에 따라 달라지지 않게 한다.
    getTodayStr: vi.fn(() => '2000-01-01'),
    getCurrentTimeStr: vi.fn(() => '12:00'),
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
import {
    createReservationSafe, updateReservation, deleteRecurringGroup,
    cancelRecurringGroup, detachFromRecurringGroup,
} from '@/lib/firestore';
import { findOverlappingReservation, getTodayStr, getCurrentTimeStr } from '@/hooks/utils/reservationUtils';
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
        vi.mocked(isVehicleRestrictedForUser).mockReturnValue(false);
        vi.mocked(generateRecurringDates).mockReturnValue([]);
        vi.mocked(getTodayStr).mockReturnValue('2000-01-01');
        vi.mocked(getCurrentTimeStr).mockReturnValue('12:00');
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

    it('같은 사용자가 같은 시간대에 다른 차량을 예약하는 것은 차단하지 않는다', async () => {
        // 행사·대규모 외근 대응. FAQ(multiple-reservations-same-time) 및 서버 코어와 동일한 정책.
        // 겹침 검사를 실제 구현으로 되돌려야 픽스처가 로직에 도달한다 (기본 mock은 항상 null이라 무의미).
        const actual = await vi.importActual<typeof import('@/hooks/utils/reservationUtils')>('@/hooks/utils/reservationUtils');
        vi.mocked(findOverlappingReservation).mockImplementation(actual.findOverlappingReservation);
        const deps = makeDeps({
            reservations: [
                { id: 'r9', vehicleId: 'v2', reservedByUid: 'u1', date: '2026-07-15', startTime: '10:00', endTime: '11:00', status: 'reserved' },
            ] as unknown as ActionDeps['reservations'],
        });
        await handleSubmit(fakeEvent(), deps);
        expect(createReservationSafe).toHaveBeenCalledTimes(1);
        expect(vi.mocked(createReservationSafe).mock.calls[0][0]).toMatchObject({
            vehicleId: 'v1',
            startTime: '10:00',
            endTime: '11:00',
        });
    });

    it('같은 차량이면 실제 겹침 검사가 차단한다 (위 케이스의 대조군)', async () => {
        // 위 테스트가 mock 때문에 항상 통과하는 허수가 아님을 보장한다.
        const actual = await vi.importActual<typeof import('@/hooks/utils/reservationUtils')>('@/hooks/utils/reservationUtils');
        vi.mocked(findOverlappingReservation).mockImplementation(actual.findOverlappingReservation);
        const deps = makeDeps({
            reservations: [
                { id: 'r9', vehicleId: 'v1', reservedByUid: 'u2', date: '2026-07-15', startTime: '10:00', endTime: '11:00', status: 'reserved' },
            ] as unknown as ActionDeps['reservations'],
        });
        await handleSubmit(fakeEvent(), deps);
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

    it('종료 시간이 시작 시간보다 이르면 차단한다 (입력 중이 아니라 제출 시점 판정)', async () => {
        const deps = makeDeps({
            form: { vehicleId: 'v1', destination: '목적지', purpose: '업무', startTime: '14:00', endTime: '13:00' } as unknown as ReservationForm,
        });
        await handleSubmit(fakeEvent(), deps);
        expect(deps.showToast).toHaveBeenCalledWith('종료 시간은 시작 시간보다 늦어야 합니다.', 'warning');
        expect(createReservationSafe).not.toHaveBeenCalled();
    });

    it('오늘 날짜에 이미 지난 시간으로는 예약하지 못한다', async () => {
        vi.mocked(getTodayStr).mockReturnValue('2026-07-15'); // selectedDate와 같은 날 = 오늘
        vi.mocked(getCurrentTimeStr).mockReturnValue('17:58');
        const deps = makeDeps();  // 10:00 ~ 11:00
        await handleSubmit(fakeEvent(), deps);
        expect(deps.showToast).toHaveBeenCalledWith('이미 지난 시간으로는 예약할 수 없습니다.', 'warning');
        expect(createReservationSafe).not.toHaveBeenCalled();
    });

    it('시작 시간을 바꾸지 않은 수정은 이미 지난 시간이어도 막지 않는다', async () => {
        // 오늘 09:00 예약의 목적지만 고치는 경우까지 막으면 손댈 방법이 없어진다
        vi.mocked(getTodayStr).mockReturnValue('2026-07-15');
        vi.mocked(getCurrentTimeStr).mockReturnValue('17:58');
        const deps = makeDeps({
            editingReservation: { id: 'r1', startTime: '10:00', endTime: '11:00' } as never,
        });
        await handleSubmit(fakeEvent(), deps);
        expect(updateReservation).toHaveBeenCalledTimes(1);
    });

    describe('반복 그룹 수정', () => {
        const recurringDeps = (overrides: Partial<ActionDeps> = {}) => makeDeps({
            editingReservation: { id: 'r1', startTime: '10:00', endTime: '11:00' } as never,
            editingRecurringGroupId: 'rcr_1',
            form: {
                vehicleId: 'v1', destination: '목적지', purpose: '업무',
                startTime: '10:00', endTime: '11:00',
                isRecurring: true, recurringDays: [1, 2, 3, 4, 5],
            } as unknown as ReservationForm,
            ...overrides,
        });

        it('그룹째 다시 만들고 단건 저장은 하지 않는다', async () => {
            // 단건 저장이 끼면 폼에 남은 반복 설정이 예약 문서로 새고,
            // undefined 값이 섞이면 "Unsupported field value: undefined"로 저장이 통째로 실패한다
            vi.mocked(generateRecurringDates).mockReturnValue(['2026-07-15', '2026-07-16']);
            const deps = recurringDeps();
            await handleSubmit(fakeEvent(), deps);

            expect(updateReservation).not.toHaveBeenCalled();
            expect(deleteRecurringGroup).toHaveBeenCalledWith('rcr_1', 'org1');
            expect(createReservationSafe).toHaveBeenCalledTimes(2);
        });

        it('직원 명의를 그대로 넘긴다 — 관리자가 수정해도 명의가 넘어가지 않는다', async () => {
            // 서버(createReservationCore)가 reservedByUid를 받아 명의를 보존한다.
            // 이 값을 빼먹으면 재생성된 예약이 호출자(관리자) 명의가 되어 직원이 권한을 잃는다.
            vi.mocked(generateRecurringDates).mockReturnValue(['2026-07-15']);
            const deps = recurringDeps({
                user: { uid: 'admin1', email: 'admin@test.local' },
                userData: { organizationId: 'org1', name: '관리자', role: 'admin' } as never,
                form: {
                    vehicleId: 'v1', destination: '목적지', purpose: '업무',
                    startTime: '10:00', endTime: '11:00',
                    isRecurring: true, recurringDays: [1, 2, 3, 4, 5],
                    reservedByUid: 'emp1', reservedByName: '황직원',
                } as unknown as ReservationForm,
            });
            await handleSubmit(fakeEvent(), deps);

            expect(vi.mocked(createReservationSafe).mock.calls[0][0]).toMatchObject({
                reservedByUid: 'emp1',
                reservedByName: '황직원',
            });
        });

        it('만들 날짜가 없으면 기존 그룹을 지우지 않는다', async () => {
            // 지우고 나서 알면 그룹만 사라지고 되돌릴 방법이 없다
            vi.mocked(generateRecurringDates).mockReturnValue([]);
            const deps = recurringDeps();
            await handleSubmit(fakeEvent(), deps);

            expect(deleteRecurringGroup).not.toHaveBeenCalled();
            expect(deps.showToast).toHaveBeenCalledWith('반복 예약할 날짜가 없습니다.', 'warning');
        });

        describe('반복 → 단건 전환 (반복 체크를 끈 채 제출)', () => {
            /** 수정을 누른 회차가 8/10, 같은 그룹에 8/3·8/17이 더 있는 상태 */
            const convertDeps = (overrides: Partial<ActionDeps> = {}) => recurringDeps({
                editingReservation: { id: 'r2', date: '2026-08-10', startTime: '10:00', endTime: '11:00' } as never,
                form: {
                    vehicleId: 'v1', destination: '목적지', purpose: '업무',
                    startTime: '10:00', endTime: '11:00',
                    // ReservationTypeSelector가 체크를 끄면 반복 필드는 undefined로 비워진다
                    isRecurring: false, recurringDays: undefined, recurringEndDate: undefined,
                } as unknown as ReservationForm,
                reservations: [
                    { id: 'r1', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-03', startTime: '10:00', endTime: '11:00', status: 'reserved' },
                    { id: 'r2', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-10', startTime: '10:00', endTime: '11:00', status: 'reserved' },
                    { id: 'r3', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-17', startTime: '10:00', endTime: '11:00', status: 'reserved' },
                ] as unknown as ActionDeps['reservations'],
                ...overrides,
            });

            it('수정을 누른 회차만 남기고 나머지를 취소한다', async () => {
                const deps = convertDeps();
                await handleSubmit(fakeEvent(), deps);

                // 남길 회차를 exceptId로 넘겨야 자기 자신까지 취소되지 않는다
                expect(cancelRecurringGroup).toHaveBeenCalledWith('rcr_1', 'org1', 'r2');
                expect(detachFromRecurringGroup).toHaveBeenCalledTimes(1);
                expect(vi.mocked(detachFromRecurringGroup).mock.calls[0][0]).toBe('r2');
                // 지우고 다시 만들지 않는다 — 삭제 권한(소유자 한정)과 명의가 걸린다
                expect(deleteRecurringGroup).not.toHaveBeenCalled();
                expect(createReservationSafe).not.toHaveBeenCalled();
            });

            it('취소될 건수를 밝히고 확인을 받는다', async () => {
                const deps = convertDeps();
                await handleSubmit(fakeEvent(), deps);

                expect(deps.confirm).toHaveBeenCalledTimes(1);
                expect(vi.mocked(deps.confirm).mock.calls[0][0]).toMatchObject({
                    message: expect.stringContaining('나머지 2건'),
                });
            });

            it('확인을 취소하면 아무것도 건드리지 않는다', async () => {
                const deps = convertDeps({ confirm: vi.fn(() => Promise.resolve(false)) });
                await handleSubmit(fakeEvent(), deps);

                expect(cancelRecurringGroup).not.toHaveBeenCalled();
                expect(detachFromRecurringGroup).not.toHaveBeenCalled();
            });

            it('남길 회차의 날짜에 다른 예약이 있으면 전환하지 않는다', async () => {
                const actual = await vi.importActual<typeof import('@/hooks/utils/reservationUtils')>('@/hooks/utils/reservationUtils');
                vi.mocked(findOverlappingReservation).mockImplementation(actual.findOverlappingReservation);
                const deps = convertDeps({
                    reservations: [
                        { id: 'r2', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-10', startTime: '10:00', endTime: '11:00', status: 'reserved' },
                        // 같은 차량·같은 날의 남의 예약 (그룹 밖)
                        { id: 'x9', vehicleId: 'v1', date: '2026-08-10', startTime: '10:30', endTime: '12:00', status: 'reserved' },
                    ] as unknown as ActionDeps['reservations'],
                });
                await handleSubmit(fakeEvent(), deps);

                expect(cancelRecurringGroup).not.toHaveBeenCalled();
                expect(detachFromRecurringGroup).not.toHaveBeenCalled();
            });

            it('같은 그룹의 다른 회차는 충돌로 보지 않는다 (전환과 함께 취소되므로)', async () => {
                const actual = await vi.importActual<typeof import('@/hooks/utils/reservationUtils')>('@/hooks/utils/reservationUtils');
                vi.mocked(findOverlappingReservation).mockImplementation(actual.findOverlappingReservation);
                const deps = convertDeps();
                await handleSubmit(fakeEvent(), deps);

                expect(detachFromRecurringGroup).toHaveBeenCalledTimes(1);
            });
        });

        describe('반복 → 다일 전환 (다일 체크 후 제출)', () => {
            /**
             * 그룹의 첫 회차가 8/3(폼이 '시작일'로 보여 주는 selectedDate),
             * 나머지가 8/10·8/17. 8/3~8/5 사흘짜리 연속 예약으로 바꾼다.
             */
            const toMultiDayDeps = (overrides: Partial<ActionDeps> = {}) => recurringDeps({
                selectedDate: '2026-08-03',
                editingReservation: { id: 'r1', date: '2026-08-03', startTime: '10:00', endTime: '11:00' } as never,
                form: {
                    vehicleId: 'v1', destination: '목적지', purpose: '업무',
                    startTime: '10:00', endTime: '11:00',
                    isRecurring: false, endDate: '2026-08-05',
                } as unknown as ReservationForm,
                reservations: [
                    { id: 'r1', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-03', startTime: '10:00', endTime: '11:00', status: 'reserved' },
                    { id: 'r2', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-10', startTime: '10:00', endTime: '11:00', status: 'reserved' },
                    { id: 'r3', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-17', startTime: '10:00', endTime: '11:00', status: 'reserved' },
                ] as unknown as ActionDeps['reservations'],
                ...overrides,
            });

            it('시작일 회차를 다일 그룹의 첫날로 옮기고 둘째 날부터를 만든다', async () => {
                const deps = toMultiDayDeps();
                await handleSubmit(fakeEvent(), deps);

                // 첫날은 지우고 다시 만들지 않는다 — 삭제 권한(소유자 한정)과 명의가 걸린다
                expect(cancelRecurringGroup).toHaveBeenCalledWith('rcr_1', 'org1', 'r1');
                expect(deleteRecurringGroup).not.toHaveBeenCalled();

                const [detachedId, detachedData] = vi.mocked(detachFromRecurringGroup).mock.calls[0];
                expect(detachedId).toBe('r1');
                expect(detachedData).toMatchObject({ startTime: '10:00', endTime: '23:59' });
                expect(detachedData.groupId).toMatch(/^grp_/);

                // 8/4(하루 종일) · 8/5(반납까지) 2건만 새로 만든다
                const created = vi.mocked(createReservationSafe).mock.calls.map(c => c[0]);
                expect(created).toHaveLength(2);
                expect(created[0]).toMatchObject({ date: '2026-08-04', startTime: '00:00', endTime: '23:59' });
                expect(created[1]).toMatchObject({ date: '2026-08-05', startTime: '00:00', endTime: '11:00' });
                // 첫날과 같은 그룹으로 묶여야 한 건의 연속 예약이 된다
                expect(created[0].groupId).toBe(detachedData.groupId);
                expect(created[1].groupId).toBe(detachedData.groupId);
            });

            it('취소될 건수를 밝히고 확인을 받는다', async () => {
                const deps = toMultiDayDeps();
                await handleSubmit(fakeEvent(), deps);

                expect(vi.mocked(deps.confirm).mock.calls[0][0]).toMatchObject({
                    message: expect.stringContaining('3일간'),
                });
                expect(vi.mocked(deps.confirm).mock.calls[0][0].message).toContain('2건을 취소');
            });

            it('확인을 취소하면 아무것도 건드리지 않는다', async () => {
                const deps = toMultiDayDeps({ confirm: vi.fn(() => Promise.resolve(false)) });
                await handleSubmit(fakeEvent(), deps);

                expect(cancelRecurringGroup).not.toHaveBeenCalled();
                expect(detachFromRecurringGroup).not.toHaveBeenCalled();
                expect(createReservationSafe).not.toHaveBeenCalled();
            });

            it('구간 중간 날짜에 남의 예약이 있으면 그룹을 취소하지 않는다', async () => {
                // 첫날만 보고 시작하면 취소를 마친 뒤 중간에서 막혀 되돌릴 것이 없다
                const actual = await vi.importActual<typeof import('@/hooks/utils/reservationUtils')>('@/hooks/utils/reservationUtils');
                vi.mocked(findOverlappingReservation).mockImplementation(actual.findOverlappingReservation);
                const deps = toMultiDayDeps({
                    reservations: [
                        { id: 'r1', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-03', startTime: '10:00', endTime: '11:00', status: 'reserved' },
                        // 같은 차량을 쓰는 그룹 밖 예약이 둘째 날에 있다
                        { id: 'x9', vehicleId: 'v1', date: '2026-08-04', startTime: '09:00', endTime: '12:00', status: 'reserved' },
                    ] as unknown as ActionDeps['reservations'],
                });
                await handleSubmit(fakeEvent(), deps);

                expect(deps.showToast).toHaveBeenCalledWith(
                    '2026-08-04에 해당 차량이 이미 예약되어 있습니다. 기간이나 시간을 조정해주세요.',
                    'warning',
                );
                expect(cancelRecurringGroup).not.toHaveBeenCalled();
                expect(createReservationSafe).not.toHaveBeenCalled();
            });

            it('전환 구간 안에 있는 같은 그룹의 회차는 충돌로 보지 않는다', async () => {
                // 그 회차들은 전환과 함께 취소된다. 충돌로 보면 자기 그룹 때문에 전환이 막힌다.
                const actual = await vi.importActual<typeof import('@/hooks/utils/reservationUtils')>('@/hooks/utils/reservationUtils');
                vi.mocked(findOverlappingReservation).mockImplementation(actual.findOverlappingReservation);
                const deps = toMultiDayDeps({
                    reservations: [
                        { id: 'r1', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-03', startTime: '10:00', endTime: '11:00', status: 'reserved' },
                        { id: 'r2', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-04', startTime: '10:00', endTime: '11:00', status: 'reserved' },
                    ] as unknown as ActionDeps['reservations'],
                });
                await handleSubmit(fakeEvent(), deps);

                expect(cancelRecurringGroup).toHaveBeenCalledWith('rcr_1', 'org1', 'r1');
                expect(createReservationSafe).toHaveBeenCalledTimes(2);
            });

            it('직원 명의를 그대로 넘긴다 — 관리자가 전환해도 명의가 넘어가지 않는다', async () => {
                const deps = toMultiDayDeps({
                    user: { uid: 'admin1', email: 'admin@test.local' },
                    userData: { organizationId: 'org1', name: '관리자', role: 'admin' } as never,
                    form: {
                        vehicleId: 'v1', destination: '목적지', purpose: '업무',
                        startTime: '10:00', endTime: '11:00',
                        isRecurring: false, endDate: '2026-08-05',
                        reservedByUid: 'emp1', reservedByName: '황직원',
                    } as unknown as ReservationForm,
                });
                await handleSubmit(fakeEvent(), deps);

                expect(vi.mocked(detachFromRecurringGroup).mock.calls[0][1]).toMatchObject({ reservedByUid: 'emp1' });
                expect(vi.mocked(createReservationSafe).mock.calls[0][0]).toMatchObject({
                    reservedByUid: 'emp1',
                    reservedByName: '황직원',
                });
            });

            it('시작일에 남은 회차가 없으면 전환하지 않는다', async () => {
                // 첫날로 쓸 문서가 없는데 취소부터 하면 그룹만 사라진다
                const deps = toMultiDayDeps({
                    reservations: [
                        { id: 'r2', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-08-10', startTime: '10:00', endTime: '11:00', status: 'reserved' },
                    ] as unknown as ActionDeps['reservations'],
                });
                await handleSubmit(fakeEvent(), deps);

                expect(deps.showToast).toHaveBeenCalledWith(
                    '전환할 시작일 예약을 찾을 수 없습니다. 목록에서 수정을 다시 눌러주세요.',
                    'warning',
                );
                expect(cancelRecurringGroup).not.toHaveBeenCalled();
            });
        });

        it('수정 중인 그룹 자신은 충돌로 보지 않는다', async () => {
            // 그룹 수정은 지우고 다시 만드는 방식이라 자기 예약과의 겹침은 충돌이 아니다.
            // 제외하지 않으면 시간을 바꾸려 할 때마다 "이미 예약되어 있습니다"로 막힌다.
            const actual = await vi.importActual<typeof import('@/hooks/utils/reservationUtils')>('@/hooks/utils/reservationUtils');
            vi.mocked(findOverlappingReservation).mockImplementation(actual.findOverlappingReservation);
            vi.mocked(generateRecurringDates).mockReturnValue(['2026-07-15']);
            const deps = recurringDeps({
                reservations: [
                    { id: 'r1', vehicleId: 'v1', recurringGroupId: 'rcr_1', date: '2026-07-15', startTime: '10:00', endTime: '11:00', status: 'reserved' },
                ] as unknown as ActionDeps['reservations'],
            });
            await handleSubmit(fakeEvent(), deps);

            expect(createReservationSafe).toHaveBeenCalledTimes(1);
        });

        it('다른 예약과 겹치면 그 날짜를 알려 주고 그룹을 지우지 않는다', async () => {
            const actual = await vi.importActual<typeof import('@/hooks/utils/reservationUtils')>('@/hooks/utils/reservationUtils');
            vi.mocked(findOverlappingReservation).mockImplementation(actual.findOverlappingReservation);
            vi.mocked(generateRecurringDates).mockReturnValue(['2026-07-15', '2026-07-16']);
            const deps = recurringDeps({
                reservations: [
                    { id: 'r9', vehicleId: 'v1', date: '2026-07-16', startTime: '10:30', endTime: '11:30', status: 'reserved' },
                ] as unknown as ActionDeps['reservations'],
            });
            await handleSubmit(fakeEvent(), deps);

            expect(deps.showToast).toHaveBeenCalledWith(
                '2026-07-16에 해당 차량이 이미 예약되어 있습니다. 미리보기에서 그 날짜를 제외하거나 시간을 조정해주세요.',
                'warning',
            );
            expect(deleteRecurringGroup).not.toHaveBeenCalled();
        });
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
