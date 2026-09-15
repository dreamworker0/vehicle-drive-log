import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import VehicleHistory from '../../components/employee/VehicleHistory';
import type { DriveLog } from '../../types/driveLog';

/**
 * 「더보기 → 차량 이용 내역」은 다음 운전자가 앞사람의 기록을 볼 수 있는 유일한 조회 경로인데,
 * 정작 비고가 빠져 있었다 — 주차 위치를 비고에 적어 온 기관에서 그 내용이 어디에도 닿지
 * 않았다(2026-09-15 김포시노인종합복지관 문의).
 *
 * 회귀 지점은 하나다. **비고를 적지 않은 기록에는 줄이 붙지 않아야 한다.** 대부분의 운행에는
 * 비고가 없으므로, 빈 줄이 붙으면 목록 전체가 성기게 늘어난다.
 */
const mockState = {
    vehicles: [{ id: 'v1', displayName: '스타렉스', plateNumber: '12가3456', vehicleType: 'van' }],
    selectedVehicleId: 'v1',
    selectedVehicle: { id: 'v1', displayName: '스타렉스', plateNumber: '12가3456', vehicleType: 'van' },
    logs: [] as DriveLog[],
    loading: false,
    logsLoading: false,
    totalDistance: 50,
    period: 30,
    setPeriod: () => { },
    dropdownOpen: false,
    setDropdownOpen: () => { },
    dropdownRef: { current: null },
    handleSelectVehicle: () => { },
    PERIOD_OPTIONS: [{ label: '1개월', days: 30 }],
};

vi.mock('../../hooks/useVehicleHistory', () => ({
    default: () => mockState,
}));

function log(over: Partial<DriveLog>): DriveLog {
    return {
        id: 'l1', driverName: '홍길동', destination: '서울시청',
        startKm: 1000, endKm: 1050, timestamp: new Date('2026-09-15T17:20:00'),
        ...over,
    } as DriveLog;
}

describe('차량 이용 내역 — 비고', () => {
    it('비고를 적은 기록에는 내용을 그대로 보여 준다', () => {
        mockState.logs = [log({ notes: '타워 3층 B-12' })];
        render(<VehicleHistory />);
        expect(screen.getByTestId('history-note').textContent).toContain('타워 3층 B-12');
    });

    it('비고를 적지 않은 기록에는 줄이 붙지 않는다', () => {
        mockState.logs = [log({ notes: '' }), log({ id: 'l2' })];
        render(<VehicleHistory />);
        expect(screen.queryByTestId('history-note')).toBeNull();
    });

    it('공백만 적힌 비고도 없는 것으로 본다', () => {
        mockState.logs = [log({ notes: '   ' })];
        render(<VehicleHistory />);
        expect(screen.queryByTestId('history-note')).toBeNull();
    });
});
