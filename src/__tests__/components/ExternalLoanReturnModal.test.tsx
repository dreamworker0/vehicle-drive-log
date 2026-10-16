/**
 * ExternalLoanReturnModal — 반납을 운행일지 한 건으로 쓰고 대여 묶음을 닫는다.
 * 출발 km가 직전 기록과 다르면 작성 화면처럼 직전 값을 쓸지 묻는다.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Reservation } from '@/types/reservation';

const mocks = vi.hoisted(() => ({
    createDriveLog: vi.fn(),
    updateReservationStatus: vi.fn(),
    completeReservationGroupSiblings: vi.fn(),
    resolveStartKm: vi.fn(),
    showToast: vi.fn(),
    confirm: vi.fn(),
}));
vi.mock('@/lib/firestore', () => ({
    createDriveLog: mocks.createDriveLog,
    updateReservationStatus: mocks.updateReservationStatus,
    completeReservationGroupSiblings: mocks.completeReservationGroupSiblings,
}));
vi.mock('@/hooks/driveLogForm/resolveStartKm', () => ({ resolveStartKm: mocks.resolveStartKm }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('@/hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: mocks.confirm }) }));
vi.mock('@/hooks/useTodayDashboard', () => ({ invalidateDashboardCache: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

import ExternalLoanReturnModal from '@/components/common/reservation/ExternalLoanReturnModal';

const loan = {
    id: 'd1', organizationId: 'org1', vehicleId: 'v1', vehicleName: '스타렉스', reservedByUid: '',
    date: '2026-10-01', startTime: '09:00', endTime: '18:00', status: 'reserved',
    externalLoan: { borrowerOrg: '동산 사회복지관', driverName: '홍길동' },
} as unknown as Reservation;

function setup() {
    const onDone = vi.fn();
    render(
        <ExternalLoanReturnModal
            reservation={loan} allReservations={[loan]} vehicles={[]}
            orgId="org1" adminUid="adm1" onClose={vi.fn()} onDone={onDone}
        />,
    );
    return { onDone };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveStartKm.mockResolvedValue('50000');
    mocks.createDriveLog.mockResolvedValue({ id: 'x' });
    mocks.updateReservationStatus.mockResolvedValue(undefined);
    mocks.completeReservationGroupSiblings.mockResolvedValue({ closed: 0, cancelled: 0, skippedOffline: false });
});

describe('ExternalLoanReturnModal', () => {
    it('출발 km를 채우고, 저장하면 운행일지를 쓰고 예약을 완료로 닫는다', async () => {
        const { onDone } = setup();
        await waitFor(() => expect(screen.getByLabelText('출발 km (빌려줄 때)')).toHaveValue(50000));

        fireEvent.change(screen.getByLabelText('도착 km (돌려받을 때) *'), { target: { value: '50120' } });
        fireEvent.click(screen.getByRole('button', { name: '반납 처리' }));

        await waitFor(() => expect(onDone).toHaveBeenCalled());
        expect(mocks.createDriveLog.mock.calls[0][0]).toMatchObject({
            driverUid: '', driveOrigin: 'external_loan', startKm: 50000, endKm: 50120, reservationId: 'd1',
        });
        expect(mocks.updateReservationStatus).toHaveBeenCalledWith('d1', 'completed', expect.objectContaining({ actualStartTime: '09:00' }));
        expect(mocks.completeReservationGroupSiblings).toHaveBeenCalledWith('d1', 'org1', '2026-10-01');
    });

    it('출발 km가 직전 기록과 다르면 묻고, 받아들이면 직전 값으로 다시 저장한다', async () => {
        mocks.createDriveLog
            .mockRejectedValueOnce(Object.assign(new Error('mismatch'), { code: 'REQUIRES_START_KM_CONFIRMATION', suggestedStartKm: 49990 }))
            .mockResolvedValueOnce({ id: 'x' });
        mocks.confirm.mockResolvedValue(true);
        const { onDone } = setup();
        await waitFor(() => expect(screen.getByLabelText('출발 km (빌려줄 때)')).toHaveValue(50000));

        fireEvent.change(screen.getByLabelText('도착 km (돌려받을 때) *'), { target: { value: '50120' } });
        fireEvent.click(screen.getByRole('button', { name: '반납 처리' }));

        await waitFor(() => expect(onDone).toHaveBeenCalled());
        expect(mocks.createDriveLog.mock.calls[1][0]).toMatchObject({ startKm: 49990, isManuallyCorrected: true, originalStartKm: 50000 });
    });

    it('검증에 걸리면 저장하지 않는다', async () => {
        setup();
        await waitFor(() => expect(screen.getByLabelText('출발 km (빌려줄 때)')).toHaveValue(50000));
        fireEvent.click(screen.getByRole('button', { name: '반납 처리' })); // 도착 km 비움

        await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('0 이상의 정수'), 'warning'));
        expect(mocks.createDriveLog).not.toHaveBeenCalled();
    });
});
