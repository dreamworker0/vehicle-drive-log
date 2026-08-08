/**
 * MaintenanceForm — 관리자 정비 등록 폼의 음수 입력 차단 검증.
 *
 * `min="0"`은 저장 시점에만 걸려서, 사용자는 `-13`을 다 적고 저장 버튼을 누른 뒤에야
 * 잘못을 알았다. 입력 즉시 마이너스가 남지 않아야 한다.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import MaintenanceForm from '../../components/admin/maintenanceLog/MaintenanceForm';
import type { Vehicle } from '../../types/vehicle';

const INITIAL_FORM = {
    vehicleId: '', vehicleName: '', date: '2026-08-08', type: 'oil',
    cost: '', shop: '', km: '', nextDueKm: '', nextDueDate: '',
    description: '', blockVehicle: false, blockEndDate: '',
};

const vehicles = [{ id: 'v1', displayName: '1호차', plateNumber: '12가3456' }] as Vehicle[];

/** setForm이 실제 상태를 갱신해야 정리된 값이 화면에 반영되는지 볼 수 있다 */
const Harness = () => {
    const [form, setForm] = useState(INITIAL_FORM);
    return (
        <MaintenanceForm
            form={form}
            setForm={setForm}
            vehicles={vehicles}
            editingId={null}
            saving={false}
            onSubmit={vi.fn()}
            onVehicleSelect={vi.fn()}
            onCancelEdit={vi.fn()}
        />
    );
};

// 숫자 칸은 DOM 순서대로 비용 → 현재 km → 다음 정비 km
const FIELDS = [
    { name: '비용', index: 0 },
    { name: '현재 km', index: 1 },
    { name: '다음 정비 km', index: 2 },
];

describe('MaintenanceForm — 음수 입력 차단', () => {
    beforeEach(() => {
        render(<Harness />);
    });

    it.each(FIELDS)('$name 칸은 마이너스를 넣어도 부호가 남지 않는다', ({ index }) => {
        const input = screen.getAllByRole('spinbutton')[index];

        fireEvent.change(input, { target: { value: '-13' } });

        expect(input).toHaveValue(13);
    });

    it.each(FIELDS)('$name 칸에 min="0"이 걸려 있다', ({ index }) => {
        expect(screen.getAllByRole('spinbutton')[index]).toHaveAttribute('min', '0');
    });

    it('양수는 그대로 입력된다', () => {
        const cost = screen.getAllByRole('spinbutton')[0];

        fireEvent.change(cost, { target: { value: '50000' } });

        expect(cost).toHaveValue(50000);
    });

    it('숫자 칸은 비용·현재 km·다음 정비 km 세 개뿐이다', () => {
        // 칸이 늘어나면 위 인덱스 매핑이 깨지므로 함께 실패해야 한다
        expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
    });
});
