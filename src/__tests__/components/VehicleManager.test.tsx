/**
 * VehicleManager — 차량 관리 목록 화면
 *
 * 훅(useVehicleManager)은 별도 테스트가 있으므로 대체하고, **카드에 무엇이 어떻게 보이는지**만
 * 고정한다. 관리자가 이 배지들만 보고 배차·정비·보험 갱신을 판단하기 때문이다.
 *  - 전기차 배터리 🔋 — 스키마에서 필드가 빠져 실제로 안 보이던 자리다(#171에서 복구)
 *  - 보험 만료 D-day 색과 문구 (만료 / D-day / 15·30일 경계)
 *  - 캘린더 동기화 상태 3단계(정상 / 재시도 중 / 실패)
 *  - 폐차 차량 분리 표시와 삭제 버튼 노출 조건
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Vehicle } from '../../types/vehicle';

const hookState = {
    vehicles: [] as Vehicle[],
    loading: false,
    showForm: false,
    setShowForm: vi.fn(),
    editingVehicle: null as Vehicle | null,
    formLoading: false,
    form: {},
    setForm: vi.fn(),
    members: [],
    modal: null as { type: string; vehicle: Vehicle } | null,
    closeModal: vi.fn(),
    deletableIds: new Set<string>(),
    openWithCalendarError: false,
    resetForm: vi.fn(),
    handleEdit: vi.fn(),
    handleModelNameChange: vi.fn(),
    handleSubmit: vi.fn(),
    handleCalendarTestResult: vi.fn(),
    modelSuggestions: [],
    openDeleteModal: vi.fn(),
    confirmDelete: vi.fn(),
    openClearMaintenanceModal: vi.fn(),
    confirmClearMaintenance: vi.fn(),
    openRetireModal: vi.fn(),
    confirmRetire: vi.fn(),
    openRestoreModal: vi.fn(),
    confirmRestore: vi.fn(),
};

vi.mock('../../hooks/useVehicleManager', () => ({ default: () => hookState }));
vi.mock('../../components/admin/VehicleForm', () => ({ default: () => <div data-testid="vehicle-form" /> }));
vi.mock('../../components/admin/CalendarSyncTroubleshootModal', () => ({
    default: ({ vehicle }: { vehicle: { displayName?: string } | null }) =>
        vehicle ? <div data-testid="troubleshoot-modal">{vehicle.displayName}</div> : null,
}));
vi.mock('../../components/common/ConfirmModal', () => ({
    default: ({ open, title }: { open?: boolean; title?: string }) =>
        open ? <div data-testid="confirm-modal">{title}</div> : null,
}));

import VehicleManager from '../../components/admin/VehicleManager';

function vehicle(over: Partial<Vehicle> = {}): Vehicle {
    return {
        id: 'v1', organizationId: 'org1', name: '카니발', displayName: '카니발',
        modelName: '카니발 9인승', plateNumber: '12가3456', currentKm: 51234,
        vehicleType: 'van', fuelType: 'gasoline',
        ...over,
    } as Vehicle;
}

/** 오늘을 고정해 D-day 계산이 달력에 흔들리지 않게 한다 */
function freezeToday(iso = '2026-03-05T10:00:00+09:00') {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
}

function renderWith(vehicles: Vehicle[], over: Partial<typeof hookState> = {}) {
    Object.assign(hookState, { vehicles, loading: false, modal: null, deletableIds: new Set<string>(), ...over });
    return render(<VehicleManager />);
}

beforeEach(() => {
    vi.clearAllMocks();
});
afterEach(() => {
    vi.useRealTimers();
});

describe('로딩', () => {
    it('로딩 중에는 스켈레톤만 보인다', () => {
        renderWith([], { loading: true });
        expect(screen.queryByText('카니발')).not.toBeInTheDocument();
    });
});

describe('기본 정보 표시', () => {
    it('차량명·모델·번호판·누적 km를 보여준다', () => {
        renderWith([vehicle()]);

        expect(screen.getByText('카니발')).toBeInTheDocument();
        expect(screen.getByText('카니발 9인승')).toBeInTheDocument();
        expect(screen.getByText('12가3456')).toBeInTheDocument();
        expect(screen.getByText('51,234 km')).toBeInTheDocument();
    });

    it('연료 유형을 한글 라벨로 바꾸고, 모르는 값은 원문 그대로 둔다', () => {
        renderWith([vehicle({ id: 'a', fuelType: 'electric' }), vehicle({ id: 'b', fuelType: 'hydrogen' })]);

        expect(screen.getByText('전기차')).toBeInTheDocument();
        expect(screen.getByText('hydrogen')).toBeInTheDocument(); // 라벨 미정의 → 원문
    });

    it('사용 가능 직원을 지정한 차량에만 자물쇠 배지를 붙인다', () => {
        renderWith([vehicle({ id: 'a', allowedUserIds: ['u1', 'u2'] }), vehicle({ id: 'b', allowedUserIds: [] })]);
        expect(screen.getByText(/🔒 지정 2명/)).toBeInTheDocument();
        expect(screen.queryByText(/지정 0명/)).not.toBeInTheDocument();
    });
});

describe('전기차 배터리 배지', () => {
    it('전기차에 배터리 값이 있으면 표시한다', () => {
        renderWith([vehicle({ fuelType: 'electric', currentBattery: 78 })]);
        expect(screen.getByText(/🔋 78%/)).toBeInTheDocument();
    });

    it('배터리가 0%여도 표시한다 — 방전을 "모름"으로 감추지 않는다', () => {
        renderWith([vehicle({ fuelType: 'electric', currentBattery: 0 })]);
        expect(screen.getByText(/🔋 0%/)).toBeInTheDocument();
    });

    it('값이 없으면 배지를 그리지 않는다', () => {
        renderWith([vehicle({ fuelType: 'electric' })]);
        expect(screen.queryByText(/🔋/)).not.toBeInTheDocument();
    });

    it('내연기관 차량에는 배터리를 붙이지 않는다', () => {
        renderWith([vehicle({ fuelType: 'gasoline', currentBattery: 50 })]);
        expect(screen.queryByText(/🔋/)).not.toBeInTheDocument();
    });
});

describe('보험 만료 안내', () => {
    it.each([
        ['이미 지난 날짜', '2026-03-01', '만료됨'],
        ['오늘', '2026-03-05', 'D-day'],
        ['15일 이내', '2026-03-15', 'D-10'],
        ['30일 이내', '2026-04-01', 'D-27'],
        ['여유 있음', '2026-12-31', 'D-301'],
    ])('%s → %s', (_label, expiryDate, expected) => {
        freezeToday();
        renderWith([vehicle({ insurance: { company: 'DB', phone: '', expiryDate } })]);
        expect(screen.getByText(new RegExp(expected.replace('-', '\\-')))).toBeInTheDocument();
    });

    it('날짜 형식이 깨졌으면 배지 없이 원문만 보인다', () => {
        freezeToday();
        renderWith([vehicle({ insurance: { company: 'DB', phone: '', expiryDate: '날짜아님' } })]);
        expect(screen.getByText(/만료 날짜아님/)).toBeInTheDocument();
        expect(screen.queryByText(/D-/)).not.toBeInTheDocument();
    });

    it('보험사 전화번호는 바로 걸 수 있는 링크로 만든다', () => {
        renderWith([vehicle({ insurance: { company: 'DB', phone: '1588-0000' } })]);
        expect(screen.getByRole('link', { name: '1588-0000' })).toHaveAttribute('href', 'tel:1588-0000');
    });

    it('보험·캘린더 정보가 하나도 없으면 그 줄 자체를 그리지 않는다', () => {
        renderWith([vehicle()]);
        expect(screen.queryByText(/🛡️/)).not.toBeInTheDocument();
        expect(screen.queryByText(/📅/)).not.toBeInTheDocument();
    });
});

describe('캘린더 동기화 상태', () => {
    it('실패가 없으면 정상으로 표시한다', () => {
        renderWith([vehicle({ googleCalendarId: 'cal@group' })]);
        expect(screen.getByText('📅 캘린더 동기화 정상')).toBeInTheDocument();
    });

    it('1~2회 실패는 재시도 중으로 표시한다', () => {
        renderWith([vehicle({ googleCalendarId: 'cal@group', calendarSyncFailCount: 2 })]);
        expect(screen.getByText('📅 재시도 중')).toBeInTheDocument();
    });

    it('3회 이상 실패하면 눌러서 해결 방법을 볼 수 있는 버튼으로 바뀐다', () => {
        renderWith([vehicle({ googleCalendarId: 'cal@group', calendarSyncFailCount: 3 })]);

        const btn = screen.getByRole('button', { name: /캘린더 동기화 실패/ });
        fireEvent.click(btn);
        expect(screen.getByTestId('troubleshoot-modal')).toHaveTextContent('카니발');
    });
});

describe('정비 중 표시', () => {
    it('정비로 차단된 차량에 배지와 완료 버튼을 보인다', () => {
        freezeToday();
        renderWith([vehicle({
            maintenance: { isBlocked: true, reason: '엔진', endDate: '2026-03-20', recordId: 'm1', blockedAt: new Date() },
        })]);

        expect(screen.getByText(/🔧 정비 중 ~03-20/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '✓ 정비 완료' }));
        expect(hookState.openClearMaintenanceModal).toHaveBeenCalled();
    });

    it('종료일이 없으면 기간 없이 정비 중만 표시한다', () => {
        freezeToday();
        renderWith([vehicle({
            maintenance: { isBlocked: true, reason: '엔진', endDate: null, recordId: 'm1', blockedAt: new Date() },
        })]);
        expect(screen.getByText('🔧 정비 중')).toBeInTheDocument();
    });
});

describe('폐차 차량', () => {
    const retired = vehicle({
        id: 'dead', displayName: '옛 스타렉스',
        retired: { isRetired: true, reason: '노후화', retiredAt: new Date() },
    });

    it('폐차 사유와 배지를 보이고 복원·삭제만 제공한다', () => {
        renderWith([retired]);

        expect(screen.getByText('폐차')).toBeInTheDocument();
        expect(screen.getByText(/🚫 노후화/)).toBeInTheDocument();

        fireEvent.click(screen.getByTitle('복원'));
        expect(hookState.openRestoreModal).toHaveBeenCalled();

        fireEvent.click(screen.getByTitle('차량 삭제'));
        expect(hookState.openDeleteModal).toHaveBeenCalled();
    });

    it('폐차 차량은 활성 목록의 폐차 버튼을 갖지 않는다', () => {
        renderWith([retired]);
        expect(screen.queryByTitle('폐차')).not.toBeInTheDocument();
    });
});

describe('활성 차량 버튼', () => {
    it('운행일지가 없는 차량에만 삭제 버튼을 노출한다', () => {
        const withDelete = renderWith([vehicle({ id: 'v1' })], { deletableIds: new Set(['v1']) });
        const buttonsWhenDeletable = screen.getAllByRole('button').length;
        withDelete.unmount();

        renderWith([vehicle({ id: 'v1' })], { deletableIds: new Set<string>() });
        expect(screen.getAllByRole('button').length).toBe(buttonsWhenDeletable - 1);
    });

    it('폐차 버튼을 누르면 모달을 연다', () => {
        renderWith([vehicle()]);
        fireEvent.click(screen.getByTitle('폐차'));
        expect(hookState.openRetireModal).toHaveBeenCalled();
    });
});

describe('확인 모달', () => {
    it.each([
        ['delete', '차량 삭제'],
        ['clearMaintenance', '정비 완료'],
        ['retire', '차량 폐차'],
        ['restore', '차량 복원'],
    ])('%s 모달은 "%s" 제목으로 뜬다', (type, title) => {
        renderWith([vehicle()], { modal: { type, vehicle: vehicle() } });
        expect(screen.getByTestId('confirm-modal')).toHaveTextContent(title);
    });

    it('모달이 없으면 그리지 않는다', () => {
        renderWith([vehicle()], { modal: null });
        expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument();
    });
});
