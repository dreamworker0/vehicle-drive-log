/**
 * ReservationSidePanel — 예약 사이드 패널
 *
 * 이 패널이 스스로 판단하는 것만 고정한다(자식 입력 컴포넌트는 각자 테스트가 있거나
 * 이 패널의 관심사가 아니므로 대체한다):
 *  - 차량 목록: 폐차 제외 + 사용 빈도 정렬
 *  - 지난 날짜: 새 예약은 막되 **수정 중이면 폼을 연다**(죽은 '수정' 버튼 방지)
 *  - 시작 시각 하한: 오늘이면 현재 시각, 단 **반복 예약에는 걸지 않는다**
 *    (하한을 걸면 내일 이후 회차의 오전 시간대를 브라우저 검증이 막아 제출 자체가 안 된다)
 *  - 반복 → 단건/다일 전환 안내: 무엇이 남고 몇 건이 취소되는지
 *  - 제출 버튼 문구: 생성/수정/전환 × 진행중 여부
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReservationSidePanel from '../../components/common/ReservationSidePanel';
import type { Vehicle } from '../../types/vehicle';
import type { Reservation, ReservationForm } from '../../types/reservation';

// ── 자식 컴포넌트 대체 ──
// 차량 선택기는 어떤 차량이 어떤 순서로 넘어왔는지만 확인하면 된다.
vi.mock('../../components/common/reservation/VehicleSelector', () => ({
    default: ({ vehicles }: { vehicles: { id: string; name?: string }[] }) => (
        <div data-testid="vehicle-selector">{vehicles.map(v => v.id).join(',')}</div>
    ),
}));
vi.mock('../../components/common/reservation/DestinationInput', () => ({
    default: () => <div data-testid="destination-input" />,
}));
vi.mock('../../components/common/reservation/RouteInfoPanel', () => ({
    default: () => <div data-testid="route-info" />,
}));
vi.mock('../../components/common/reservation/RecurringReservationPanel', () => ({
    default: () => <div data-testid="recurring-panel" />,
}));
vi.mock('../../components/common/reservation/ReservationTypeSelector', () => ({
    default: () => <div data-testid="type-selector" />,
}));
vi.mock('../../components/common/reservation/ReservationPassengerField', () => ({
    default: () => <div data-testid="passenger-field" />,
}));
vi.mock('../../components/common/reservation/ReservationTabContent', () => ({
    default: ({ activeRes, completedRes }: { activeRes: unknown[]; completedRes: unknown[] }) => (
        <div data-testid="tab-content">{`active:${activeRes.length} completed:${completedRes.length}`}</div>
    ),
}));

function vehicle(over: Partial<Vehicle> = {}): Vehicle {
    return {
        id: 'v1', organizationId: 'org1', name: '카니발', plateNumber: '12가3456', currentKm: 0,
        ...over,
    } as Vehicle;
}

function reservation(over: Partial<Reservation> = {}): Reservation {
    return {
        id: 'r1', organizationId: 'org1', vehicleId: 'v1', reservedByUid: 'u1',
        date: '2026-03-05', startTime: '09:00', endTime: '11:00', status: 'reserved',
        ...over,
    } as Reservation;
}

const baseForm: ReservationForm = {
    vehicleId: 'v1', destination: '', purpose: '', startTime: '09:00', endTime: '11:00',
};

function setup(over: Partial<React.ComponentProps<typeof ReservationSidePanel>> = {}) {
    const props: React.ComponentProps<typeof ReservationSidePanel> = {
        selectedDate: '2026-03-05',
        sideTab: 'list',
        setSideTab: vi.fn(),
        showForm: true,
        setShowForm: vi.fn(),
        form: baseForm,
        setForm: vi.fn(),
        vehicles: [vehicle()],
        favorites: [],
        selectedReservations: [],
        isPastDate: false,
        isToday: false,
        submitting: false,
        editingReservation: null,
        routeInfo: null,
        routeLoading: false,
        user: { uid: 'u1' },
        getCurrentTimeStr: () => '13:45',
        getMinStartTime: () => '00:00',
        getNavigationDeeplink: () => '',
        onSubmit: vi.fn(async () => {}),
        onEdit: vi.fn(),
        onCancel: vi.fn(async () => {}),
        onSlotClick: vi.fn(),
        showFavSave: false,
        setShowFavSave: vi.fn(),
        favName: '',
        setFavName: vi.fn(),
        onSaveFavorite: vi.fn(async () => {}),
        onOpenForm: vi.fn(),
        ...over,
    };
    return { ...render(<ReservationSidePanel {...props} />), props };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('날짜가 없을 때', () => {
    it('안내만 보여주고 폼을 그리지 않는다', () => {
        setup({ selectedDate: '' });
        expect(screen.getByText('날짜를 선택하세요')).toBeInTheDocument();
        expect(screen.queryByTestId('vehicle-selector')).not.toBeInTheDocument();
    });
});

describe('차량 목록', () => {
    it('폐차된 차량은 뺀다', () => {
        setup({
            vehicles: [
                vehicle({ id: 'live' }),
                vehicle({ id: 'dead', retired: { isRetired: true, reason: '', retiredAt: new Date() } }),
            ],
        });
        expect(screen.getByTestId('vehicle-selector')).toHaveTextContent('live');
        expect(screen.getByTestId('vehicle-selector')).not.toHaveTextContent('dead');
    });

    it('사용 횟수가 많은 차량을 앞에 둔다', () => {
        setup({
            vehicles: [vehicle({ id: 'a' }), vehicle({ id: 'b' }), vehicle({ id: 'c' })],
            usageCounts: new Map([['b', 5], ['c', 2]]),
        });
        expect(screen.getByTestId('vehicle-selector')).toHaveTextContent('b,c,a');
    });

    it('사용 이력이 없으면 원래 순서를 유지한다', () => {
        setup({ vehicles: [vehicle({ id: 'a' }), vehicle({ id: 'b' })], usageCounts: new Map() });
        expect(screen.getByTestId('vehicle-selector')).toHaveTextContent('a,b');
    });
});

describe('지난 날짜', () => {
    it('새 예약 버튼을 숨기고 폼도 열지 않는다', () => {
        setup({ isPastDate: true });
        expect(screen.queryByRole('button', { name: /예약/ })).not.toBeInTheDocument();
        expect(screen.queryByTestId('vehicle-selector')).not.toBeInTheDocument();
    });

    it('수정 중이면 폼은 연다 — 목록의 수정 버튼이 죽지 않도록', () => {
        setup({ isPastDate: true, editingReservation: reservation() });
        expect(screen.getByTestId('vehicle-selector')).toBeInTheDocument();
    });
});

describe('시작 시각 하한', () => {
    const startInput = () => document.querySelector('input[type="time"]') as HTMLInputElement;

    it('오늘이 아니면 하한이 없다', () => {
        setup({ isToday: false });
        expect(startInput()).toHaveAttribute('min', '00:00');
    });

    it('오늘이면 현재 시각을 하한으로 건다', () => {
        setup({ isToday: true });
        expect(startInput()).toHaveAttribute('min', '13:45');
    });

    it('반복 예약이면 오늘이어도 하한을 걸지 않는다 — 이후 회차의 오전 시간대가 막히기 때문', () => {
        setup({
            isToday: true,
            form: {
                ...baseForm,
                isRecurring: true,
                recurringStartDate: '2026-03-05',
                recurringEndDate: '2026-03-19',
                recurringDays: [4], // 목요일 = 2026-03-05
            },
        });
        expect(startInput()).toHaveAttribute('min', '00:00');
    });
});

describe('반복 → 단건/다일 전환 안내', () => {
    const recurringSiblings = [
        reservation({ id: 'r1', recurringGroupId: 'g1' }),
        reservation({ id: 'r2', recurringGroupId: 'g1' }),
        reservation({ id: 'r3', recurringGroupId: 'g1', status: 'cancelled' }),
        reservation({ id: 'other', recurringGroupId: 'g2' }),
    ];

    it('반복 체크를 끄면 남는 날짜와 취소될 건수를 알린다 (취소된 회차는 세지 않는다)', () => {
        setup({
            editingReservation: reservation({ id: 'r1', recurringGroupId: 'g1' }),
            editingRecurringGroupId: 'g1',
            allReservations: recurringSiblings,
            form: { ...baseForm, isRecurring: false },
        });

        expect(screen.getByText('📌 단건 예약으로 전환')).toBeInTheDocument();
        expect(screen.getByText(/나머지 1건은 취소됩니다/)).toBeInTheDocument();
    });

    it('종료일까지 잡으면 다일 전환으로 안내하고 일수를 센다(첫날 포함)', () => {
        setup({
            editingReservation: reservation({ id: 'r1', recurringGroupId: 'g1' }),
            editingRecurringGroupId: 'g1',
            allReservations: recurringSiblings,
            form: { ...baseForm, isRecurring: false, endDate: '2026-03-07' },
        });

        expect(screen.getByText('📌 다일(연속) 예약으로 전환')).toBeInTheDocument();
        expect(screen.getByText(/3일간/)).toBeInTheDocument();
        expect(screen.queryByText('📌 단건 예약으로 전환')).not.toBeInTheDocument();
    });

    it('반복 체크가 켜져 있으면 전환 안내 대신 반복 설정 패널을 보인다', () => {
        setup({
            editingReservation: reservation({ recurringGroupId: 'g1' }),
            editingRecurringGroupId: 'g1',
            form: { ...baseForm, isRecurring: true },
        });
        expect(screen.getByTestId('recurring-panel')).toBeInTheDocument();
        expect(screen.queryByText('📌 단건 예약으로 전환')).not.toBeInTheDocument();
    });

    it('새 예약에는 전환 안내를 띄우지 않는다', () => {
        setup({ editingRecurringGroupId: 'g1', editingReservation: null });
        expect(screen.queryByText('📌 단건 예약으로 전환')).not.toBeInTheDocument();
    });
});

describe('제출 버튼 문구', () => {
    const label = () => screen.getByRole('button', { name: /예약|전환|중\.\.\./ }).textContent;

    it.each([
        ['새 예약', {}, '예약 확정'],
        ['반복 예약 생성', { form: { ...baseForm, isRecurring: true } }, '반복 예약 확정'],
        ['단건 수정', { editingReservation: reservation() }, '예약 수정'],
        ['다일 수정', { editingReservation: reservation(), editingGroupId: 'g1' }, '다일 예약 수정'],
        ['반복 수정', { editingReservation: reservation(), editingRecurringGroupId: 'g1', form: { ...baseForm, isRecurring: true } }, '반복 예약 수정'],
        ['단건 전환', { editingReservation: reservation(), editingRecurringGroupId: 'g1' }, '단건 예약으로 전환'],
        ['다일 전환', { editingReservation: reservation(), editingRecurringGroupId: 'g1', form: { ...baseForm, endDate: '2026-03-07' } }, '다일 예약으로 전환'],
    ])('%s → "%s"', (_case, over, expected) => {
        const { unmount } = setup(over as Partial<React.ComponentProps<typeof ReservationSidePanel>>);
        expect(screen.getByRole('button', { name: expected })).toBeInTheDocument();
        unmount();
    });

    it('제출 중에는 진행 문구로 바꾸고 버튼을 잠근다', () => {
        setup({ submitting: true });
        const btn = screen.getByRole('button', { name: '예약 중...' });
        expect(btn).toBeDisabled();
    });

    it('전환 중에는 "전환 중..."으로 알린다', () => {
        setup({ submitting: true, editingReservation: reservation(), editingRecurringGroupId: 'g1' });
        expect(label()).toBe('전환 중...');
    });
});

describe('관리자 예약자 지정', () => {
    const members = [
        { id: 'u1', name: '홍길동', email: 'a@b.c', role: 'employee' as const, organizationId: 'org1' },
        { id: 'u2', name: '관리자', email: 'c@d.e', role: 'admin' as const, organizationId: 'org1' },
    ];

    it('관리자가 기존 예약을 수정할 때만 예약자 드롭다운이 뜬다', () => {
        setup({ isAdmin: true, editingReservation: reservation(), members });
        expect(screen.getByText('예약자')).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /관리자 \(관리자\)/ })).toBeInTheDocument();
    });

    it('새 예약이거나 관리자가 아니면 드롭다운이 없다', () => {
        const { unmount } = setup({ isAdmin: true, editingReservation: null, members });
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        unmount();

        setup({ isAdmin: false, editingReservation: reservation(), members });
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('예약자를 고르면 uid와 이름을 함께 폼에 반영한다', () => {
        const setForm = vi.fn();
        setup({ isAdmin: true, editingReservation: reservation(), members, setForm });

        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'u2' } });
        expect(setForm).toHaveBeenCalledWith(expect.objectContaining({
            reservedByUid: 'u2', reservedByName: '관리자',
        }));
    });
});

describe('동승자 입력', () => {
    it('기관이 켠 경우에만 보인다', () => {
        const { unmount } = setup({ passengerEnabled: false });
        expect(screen.queryByTestId('passenger-field')).not.toBeInTheDocument();
        unmount();

        setup({ passengerEnabled: true });
        expect(screen.getByTestId('passenger-field')).toBeInTheDocument();
    });
});

describe('목록 분류', () => {
    it('진행 중과 완료를 나눠 넘긴다 (취소는 어느 쪽에도 넣지 않는다)', () => {
        setup({
            selectedReservations: [
                reservation({ id: 'a', status: 'reserved' }),
                reservation({ id: 'b', status: 'in_progress' }),
                reservation({ id: 'c', status: 'completed' }),
                reservation({ id: 'd', status: 'cancelled' }),
            ],
        });
        expect(screen.getByTestId('tab-content')).toHaveTextContent('active:2 completed:1');
    });
});

describe('예약 열기 버튼', () => {
    it('폼이 닫혀 있으면 첫 번째 차량을 기본값으로 넘긴다', () => {
        const onOpenForm = vi.fn();
        setup({ showForm: false, onOpenForm, vehicles: [vehicle({ id: 'a' }), vehicle({ id: 'b' })], usageCounts: new Map([['b', 3]]) });

        fireEvent.click(screen.getByRole('button', { name: '+ 예약' }));
        expect(onOpenForm).toHaveBeenCalledWith('b'); // 가장 많이 쓴 차량이 앞이다
    });

    it('폼이 열려 있으면 닫기 동작이라 기본 차량을 넘기지 않는다', () => {
        const onOpenForm = vi.fn();
        setup({ showForm: true, onOpenForm });

        fireEvent.click(screen.getByRole('button', { name: '닫기' }));
        expect(onOpenForm).toHaveBeenCalledWith(undefined);
    });
});
